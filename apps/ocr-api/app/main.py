from fastapi import FastAPI

app = FastAPI(
    title="JSMath OCR/AI Pipeline",
    version="0.0.1",
    docs_url="/docs",
    root_path="/v1",
)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "ocr-api"}
