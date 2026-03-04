"""Celery task: parse Mathpix lines.json results into OcrPage/OcrLine records."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from sqlalchemy import select

from app.celery_app import celery
from app.database import worker_session
from app.models.job import OcrJobTracking
from app.models.ocr import OcrLine, OcrPage
from app.services import mathpix
from app.services.s3 import upload_bytes

logger = logging.getLogger(__name__)


def _generate_id() -> str:
    """Generate a cuid-like short ID."""
    import time
    import random
    import string

    ts = hex(int(time.time() * 1000))[2:]
    rand = "".join(random.choices(string.ascii_lowercase + string.digits, k=8))
    return f"c{ts}{rand}"


def _cnt_to_bbox(cnt: list[list[float]]) -> tuple[float, float, float, float] | None:
    """Convert Mathpix contour polygon to (x, y, w, h) bounding box.

    cnt is typically [[x1,y1],[x2,y2],[x3,y3],[x4,y4]].
    """
    if not cnt or len(cnt) < 2:
        return None
    xs = [p[0] for p in cnt]
    ys = [p[1] for p in cnt]
    x = min(xs)
    y = min(ys)
    return (x, y, max(xs) - x, max(ys) - y)


@celery.task(
    bind=True,
    name="task.ocr.parse_results",
    max_retries=3,
    default_retry_delay=10,
    retry_backoff=True,
    acks_late=True,
)
def parse_mathpix_results(
    self,
    poll_result: dict[str, str] | None = None,
    *,
    ocr_job_id: str | None = None,
    mathpix_pdf_id: str | None = None,
) -> dict[str, str | int]:
    """Fetch lines.json from Mathpix and store as OcrPage/OcrLine records."""
    if poll_result:
        ocr_job_id = poll_result["ocr_job_id"]
        mathpix_pdf_id = poll_result["mathpix_pdf_id"]

    if not ocr_job_id or not mathpix_pdf_id:
        raise ValueError("ocr_job_id and mathpix_pdf_id are required")

    return asyncio.run(_parse(self, ocr_job_id, mathpix_pdf_id))


async def _parse(self, ocr_job_id: str, mathpix_pdf_id: str) -> dict[str, str | int]:
    try:
        lines_data = await mathpix.get_lines_json(mathpix_pdf_id)
    except Exception as exc:
        logger.error("Failed to fetch lines.json for %s: %s", mathpix_pdf_id, exc)
        raise self.retry(exc=exc)

    pages_list: list[dict[str, Any]] = lines_data.get("pages", [])
    if not pages_list:
        # Fallback: maybe the response is a list directly
        if isinstance(lines_data, list):
            pages_list = lines_data

    total_lines = 0
    num_pages = len(pages_list)
    image_map: dict[int, str] = {}

    async with worker_session() as session:
        for page_data in pages_list:
            page_number = page_data.get("page", 0)
            if not page_number:
                continue

            # Collect image_id for later page image download
            image_id = page_data.get("image_id")
            if image_id:
                image_map[page_number] = image_id

            page = OcrPage(
                id=_generate_id(),
                ocr_job_id=ocr_job_id,
                page_number=page_number,
                image_s3_key=None,
                width_px=page_data.get("width"),
                height_px=page_data.get("height"),
                dpi=300,
                raw_response=page_data,
            )
            session.add(page)
            await session.flush()

            # Parse lines within this page
            lines = page_data.get("lines", [])
            for line_idx, line_obj in enumerate(lines):
                text = line_obj.get("text", "").strip()
                line_type = line_obj.get("type", "text")

                # For diagram/image lines, use text_display which contains the CDN image URL
                if not text and line_type in ("diagram", "image", "figure"):
                    text = line_obj.get("text_display", "").strip()

                if not text:
                    continue

                # Extract bbox from cnt (contour polygon)
                bbox = None
                cnt = line_obj.get("cnt")
                if cnt:
                    bbox = _cnt_to_bbox(cnt)

                ocr_line = OcrLine(
                    id=_generate_id(),
                    page_id=page.id,
                    line_number=line_idx,
                    text=text,
                    latex=line_obj.get("latex") or line_obj.get("value"),
                    line_type=line_type,
                    bbox_x=bbox[0] if bbox else None,
                    bbox_y=bbox[1] if bbox else None,
                    bbox_w=bbox[2] if bbox else None,
                    bbox_h=bbox[3] if bbox else None,
                    confidence=line_obj.get("confidence"),
                    line_data=line_obj,
                )
                session.add(ocr_line)
                total_lines += 1

        # Update job tracking
        result = await session.execute(
            select(OcrJobTracking).where(OcrJobTracking.id == ocr_job_id)
        )
        job = result.scalar_one()
        job.num_pages = num_pages

        await session.commit()

    from app.services.redis_events import notify_progress

    notify_progress(ocr_job_id, "parsing", message="결과 파싱 완료")

    logger.info(
        "Parsed %d pages, %d lines for job %s",
        num_pages,
        total_lines,
        ocr_job_id,
    )

    # Skip page image download/upload for speed
    # Page images are available via Mathpix CDN URLs in text_display

    return {
        "ocr_job_id": ocr_job_id,
        "num_pages": num_pages,
        "total_lines": total_lines,
    }


async def _save_page_images(
    ocr_job_id: str, image_map: dict[int, str]
) -> None:
    """Download page images from Mathpix CDN and store in S3, updating OcrPage records."""
    if not image_map:
        logger.info("No page images available for job %s", ocr_job_id)
        return

    async with worker_session() as session:
        for page_number, image_id in image_map.items():
            try:
                image_bytes = await mathpix.download_page_image(image_id)
                s3_key = f"pages/{ocr_job_id}/page{page_number}.png"
                upload_bytes(s3_key, image_bytes, "image/png")

                result = await session.execute(
                    select(OcrPage).where(
                        OcrPage.ocr_job_id == ocr_job_id,
                        OcrPage.page_number == page_number,
                    )
                )
                page = result.scalar_one_or_none()
                if page:
                    page.image_s3_key = s3_key

                logger.info(
                    "Saved page image %d for job %s", page_number, ocr_job_id
                )
            except Exception:
                logger.warning(
                    "Failed to save page image %d for job %s",
                    page_number,
                    ocr_job_id,
                    exc_info=True,
                )

        await session.commit()
