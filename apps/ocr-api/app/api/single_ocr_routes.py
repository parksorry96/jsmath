import httpx
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel

from app.api.security import rate_limit_single_problem_ocr
from app.config import settings

router = APIRouter(prefix="/ocr", tags=["single-ocr"])


class OcrBlock(BaseModel):
    type: str  # "text" | "math"
    content: str


class SingleOcrResponse(BaseModel):
    problem_text: str
    confidence: float
    raw_blocks: list[OcrBlock]


@router.post(
    "/single-problem",
    response_model=SingleOcrResponse,
    dependencies=[Depends(rate_limit_single_problem_ocr)],
)
async def ocr_single_problem(image: UploadFile = File(...)) -> SingleOcrResponse:
    if image.content_type not in ("image/jpeg", "image/png", "image/webp"):
        raise HTTPException(400, "Only JPEG, PNG, WebP images are supported")

    content = await image.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(400, "Image must be under 10MB")

    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(
            "https://api.mathpix.com/v3/text",
            headers={
                "app_id": settings.mathpix_app_id,
                "app_key": settings.mathpix_app_key,
            },
            files={"file": (image.filename, content, image.content_type)},
            data={
                "options_json": '{"math_inline_delimiters": ["$", "$"], "math_display_delimiters": ["$$", "$$"], "rm_spaces": true}',
            },
        )

    if resp.status_code != 200:
        raise HTTPException(502, "OCR service error")

    data = resp.json()
    latex_text = data.get("latex_styled") or data.get("text", "")
    confidence = data.get("confidence", 0.0)

    raw_blocks = []
    if "line_data" in data:
        for line in data["line_data"]:
            block_type = "math" if line.get("type") == "math" else "text"
            raw_blocks.append(OcrBlock(type=block_type, content=line.get("value", "")))
    else:
        raw_blocks.append(OcrBlock(type="math", content=latex_text))

    return SingleOcrResponse(
        problem_text=latex_text,
        confidence=confidence,
        raw_blocks=raw_blocks,
    )
