"""Shared test fixtures for OCR pipeline tests."""

from unittest.mock import MagicMock

from app.models.ocr import OcrLine, OcrPage


def make_line(
    text: str,
    *,
    line_number: int = 0,
    latex: str | None = None,
    line_type: str = "text",
    bbox_x: float | None = None,
    bbox_y: float | None = None,
    bbox_w: float | None = None,
    bbox_h: float | None = None,
) -> OcrLine:
    """Create a mock OcrLine for testing."""
    line = MagicMock(spec=OcrLine)
    line.text = text
    line.latex = latex or text
    line.line_number = line_number
    line.line_type = line_type
    line.bbox_x = bbox_x
    line.bbox_y = bbox_y
    line.bbox_w = bbox_w
    line.bbox_h = bbox_h
    return line


def make_page(page_number: int, lines: list[OcrLine]) -> OcrPage:
    """Create a mock OcrPage for testing."""
    page = MagicMock(spec=OcrPage)
    page.page_number = page_number
    page.lines = lines
    return page
