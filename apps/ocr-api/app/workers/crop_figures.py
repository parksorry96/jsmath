"""Celery task: detect and crop graphs/figures from OCR pages.

Strategy:
  1. Use Mathpix line_data coordinates to find image/figure regions.
  2. Use OpenCV edge detection as fallback for missed figures.
  3. Crop with 24px margin, save as WebP to S3.
"""

from __future__ import annotations

import asyncio
import io
import logging

import cv2
import numpy as np
from PIL import Image
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.celery_app import celery
from app.database import worker_session
from app.models.job import JobStatus, OcrJobTracking
from app.models.ocr import OcrLine, OcrPage
from app.services import s3

logger = logging.getLogger(__name__)

CROP_MARGIN_PX = 24
MIN_FIGURE_AREA = 5000  # minimum area in pixels to consider a figure


@celery.task(
    bind=True,
    name="task.graph.crop",
    max_retries=2,
    default_retry_delay=15,
    retry_backoff=True,
    acks_late=True,
)
def crop_figures(
    self,
    segment_result: dict | None = None,
    *,
    ocr_job_id: str | None = None,
) -> dict:
    """Detect and crop figures from OCR pages."""
    if segment_result:
        ocr_job_id = segment_result["ocr_job_id"]
    if not ocr_job_id:
        raise ValueError("ocr_job_id is required")

    return asyncio.run(_crop(self, ocr_job_id, segment_result))


async def _crop(task, ocr_job_id: str, segment_result: dict | None) -> dict:
    async with worker_session() as session:
        job_result = await session.execute(
            select(OcrJobTracking).where(OcrJobTracking.id == ocr_job_id)
        )
        job = job_result.scalar_one()
        job.status = JobStatus.cropping
        await session.commit()

        # Fetch pages with lines
        pages_result = await session.execute(
            select(OcrPage)
            .where(OcrPage.ocr_job_id == ocr_job_id)
            .options(selectinload(OcrPage.lines))
            .order_by(OcrPage.page_number)
        )
        pages = pages_result.scalars().all()

    crop_count = 0
    crop_results = []

    for page in pages:
        # Method 1: Find figure regions from line_data
        figure_bboxes = _find_figure_bboxes_from_lines(page.lines)

        for bbox in figure_bboxes:
            # If page image is available in S3, crop it
            if page.image_s3_key:
                crop_result = await _crop_and_upload(
                    ocr_job_id, page, bbox, "line_data"
                )
                if crop_result:
                    crop_results.append(crop_result)
                    crop_count += 1

    logger.info(
        "Cropped %d figures for job %s across %d pages",
        crop_count,
        ocr_job_id,
        len(pages),
    )

    # Crop individual problem regions from page images
    segments = segment_result.get("segments", []) if segment_result else []
    page_map = {p.page_number: p for p in pages}
    segments = await _crop_problem_images(ocr_job_id, segments, page_map)

    return {
        "ocr_job_id": ocr_job_id,
        "crop_count": crop_count,
        "crops": crop_results,
        "segments": segments,
    }


def _find_figure_bboxes_from_lines(lines: list[OcrLine]) -> list[dict]:
    """Find figure bounding boxes from Mathpix line_data.

    Looks for lines with type "image" or lines that reference figure data.
    """
    bboxes = []
    for line in lines:
        # Mathpix marks images/figures with specific types
        if line.line_type in ("image", "figure") and line.bbox_x is not None:
            area = (line.bbox_w or 0) * (line.bbox_h or 0)
            if area >= MIN_FIGURE_AREA:
                bboxes.append({
                    "x": line.bbox_x,
                    "y": line.bbox_y,
                    "w": line.bbox_w,
                    "h": line.bbox_h,
                    "line_id": line.id,
                })

        # Also check raw line_data for embedded image references
        if line.line_data and line.line_data.get("type") == "image":
            cnt = line.line_data.get("cnt", {})
            if cnt:
                area = cnt.get("w", 0) * cnt.get("h", 0)
                if area >= MIN_FIGURE_AREA:
                    bboxes.append({
                        "x": cnt.get("x", 0),
                        "y": cnt.get("y", 0),
                        "w": cnt.get("w", 0),
                        "h": cnt.get("h", 0),
                        "line_id": line.id,
                    })

    return bboxes


def detect_figures_opencv(image_bytes: bytes) -> list[dict]:
    """Fallback: use OpenCV edge detection to find figure regions.

    Used when Mathpix line_data doesn't capture all figures.
    """
    nparr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_GRAYSCALE)
    if img is None:
        return []

    # Edge detection
    edges = cv2.Canny(img, 50, 150)

    # Find contours
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    bboxes = []
    for contour in contours:
        x, y, w, h = cv2.boundingRect(contour)
        area = w * h
        if area >= MIN_FIGURE_AREA:
            bboxes.append({"x": float(x), "y": float(y), "w": float(w), "h": float(h)})

    return bboxes


async def _crop_problem_images(
    ocr_job_id: str,
    segments: list[dict],
    page_map: dict[int, OcrPage],
) -> list[dict]:
    """Crop each problem's region from its page image and upload to S3."""
    # Cache downloaded page images to avoid re-downloading
    page_image_cache: dict[int, Image.Image | None] = {}

    for segment in segments:
        bbox = segment.get("bbox")
        if not bbox:
            continue

        page_num = segment.get("start_page", 0)
        page = page_map.get(page_num)
        if not page or not page.image_s3_key:
            continue

        # Download page image (cached)
        if page_num not in page_image_cache:
            page_image_cache[page_num] = _download_page_from_s3(page.image_s3_key)
        img = page_image_cache[page_num]
        if img is None:
            continue

        try:
            margin = 12
            x = max(0, int(bbox["x"]) - margin)
            y = max(0, int(bbox["y"]) - margin)
            right = min(img.width, int(bbox["x"] + bbox["w"]) + margin)
            bottom = min(img.height, int(bbox["y"] + bbox["h"]) + margin)

            if right <= x or bottom <= y:
                continue

            cropped = img.crop((x, y, right, bottom))

            buffer = io.BytesIO()
            cropped.save(buffer, format="WEBP", quality=90)
            buffer.seek(0)

            pnum = segment.get("problem_number", "0")
            s3_key = f"problems/{ocr_job_id}/problem_{pnum}.webp"
            s3.upload_bytes(s3_key, buffer.getvalue(), content_type="image/webp")

            segment["problem_image_s3_key"] = s3_key
            logger.info(
                "Cropped problem %s for job %s (%dx%d)",
                pnum, ocr_job_id, cropped.width, cropped.height,
            )
        except Exception:
            logger.warning(
                "Failed to crop problem %s for job %s",
                segment.get("problem_number"),
                ocr_job_id,
                exc_info=True,
            )

    return segments


def _download_page_from_s3(s3_key: str) -> Image.Image | None:
    """Download a page image from S3 and return as PIL Image."""
    try:
        image_bytes = s3.download_bytes(s3_key)
        return Image.open(io.BytesIO(image_bytes))
    except Exception:
        logger.warning("Could not download page image: %s", s3_key)
        return None


async def _crop_and_upload(
    ocr_job_id: str,
    page: OcrPage,
    bbox: dict,
    detection_method: str,
) -> dict | None:
    """Crop a figure region from a page image and upload to S3."""
    # Download page image from S3
    try:
        image_bytes = s3.download_bytes(page.image_s3_key)
    except Exception:
        logger.warning("Could not download page image: %s", page.image_s3_key)
        return None

    # Open and crop
    img = Image.open(io.BytesIO(image_bytes))
    x = max(0, int(bbox["x"]) - CROP_MARGIN_PX)
    y = max(0, int(bbox["y"]) - CROP_MARGIN_PX)
    w = int(bbox["w"]) + 2 * CROP_MARGIN_PX
    h = int(bbox["h"]) + 2 * CROP_MARGIN_PX
    right = min(img.width, x + w)
    bottom = min(img.height, y + h)

    cropped = img.crop((x, y, right, bottom))

    # Convert to WebP
    buffer = io.BytesIO()
    cropped.save(buffer, format="WEBP", quality=90)
    buffer.seek(0)

    # Upload to S3
    s3_key = f"crops/{ocr_job_id}/page{page.page_number}_{x}_{y}.webp"
    s3.upload_bytes(s3_key, buffer.getvalue(), content_type="image/webp")

    # Compute quality metrics
    gray = np.array(cropped.convert("L"))
    edges = cv2.Canny(gray, 50, 150)
    edge_density = float(np.count_nonzero(edges)) / max(edges.size, 1)
    blank_ratio = float(np.count_nonzero(gray > 240)) / max(gray.size, 1)

    return {
        "page_number": page.page_number,
        "bbox": bbox,
        "s3_key": s3_key,
        "width_px": cropped.width,
        "height_px": cropped.height,
        "edge_density": edge_density,
        "blank_ratio": blank_ratio,
        "detection_method": detection_method,
    }
