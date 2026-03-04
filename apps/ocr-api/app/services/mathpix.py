"""Mathpix API client for PDF OCR processing."""

from __future__ import annotations

import logging
from typing import Any

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

MATHPIX_BASE_URL = "https://api.mathpix.com/v3"


def _headers() -> dict[str, str]:
    return {
        "app_id": settings.mathpix_app_id,
        "app_key": settings.mathpix_app_key,
    }


async def submit_pdf(s3_url: str) -> str:
    """Submit a PDF URL to Mathpix for processing. Returns the pdf_id."""
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            f"{MATHPIX_BASE_URL}/pdf",
            headers={**_headers(), "Content-Type": "application/json"},
            json={
                "url": s3_url,
                "math_inline_delimiters": ["$", "$"],
                "math_display_delimiters": ["$$", "$$"],
                "rm_spaces": True,
            },
        )
        resp.raise_for_status()
        data = resp.json()
        logger.info("Mathpix PDF submit response: %s", data)
        pdf_id = data.get("pdf_id") or data.get("request_id") or data.get("id")
        if not pdf_id:
            raise ValueError(f"No pdf_id in Mathpix response: {data}")
        logger.info("Mathpix PDF submitted: pdf_id=%s", pdf_id)
        return pdf_id


async def get_status(pdf_id: str) -> dict[str, Any]:
    """Poll Mathpix for PDF processing status.

    Returns dict with keys: status, num_pages, num_pages_completed, percent_done.
    Status values: received, loaded, split, completed, error.
    """
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"{MATHPIX_BASE_URL}/pdf/{pdf_id}",
            headers=_headers(),
        )
        resp.raise_for_status()
        return resp.json()


async def get_lines_json(pdf_id: str) -> dict[str, Any]:
    """Fetch the lines.json result from a completed Mathpix PDF job.

    Returns dict with "pages" key containing page objects with line_data.
    """
    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.get(
            f"{MATHPIX_BASE_URL}/pdf/{pdf_id}.lines.json",
            headers=_headers(),
        )
        resp.raise_for_status()
        return resp.json()


async def get_page_images_map(pdf_id: str) -> dict[int, str]:
    """Fetch page_number → image_id mapping from Mathpix lines.json.

    Returns dict like {1: "pdf_id-01", 2: "pdf_id-02", ...}.
    """
    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.get(
            f"{MATHPIX_BASE_URL}/pdf/{pdf_id}.lines.json",
            headers=_headers(),
        )
        resp.raise_for_status()
        data = resp.json()

    pages = data.get("pages", [])
    result: dict[int, str] = {}
    for p in pages:
        page_num = p.get("page", 0)
        image_id = p.get("image_id")
        if page_num and image_id:
            result[page_num] = image_id
    return result


async def download_page_image(image_id: str) -> bytes:
    """Download a page image from Mathpix CDN by image_id.

    image_id comes from lines.json (e.g. "pdf_id-01").
    """
    url = f"https://cdn.mathpix.com/cropped/{image_id}.png"
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        return resp.content


async def get_mmd(pdf_id: str) -> str:
    """Fetch the Mathpix Markdown result from a completed Mathpix PDF job."""
    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.get(
            f"{MATHPIX_BASE_URL}/pdf/{pdf_id}.mmd",
            headers=_headers(),
        )
        resp.raise_for_status()
        return resp.text
