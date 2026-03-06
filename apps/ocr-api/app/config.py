from pydantic import Field
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/jsmath"

    @property
    def async_database_url(self) -> str:
        """Ensure URL uses asyncpg driver regardless of env var format."""
        url = self.database_url
        for prefix in ("postgresql+psycopg://", "postgresql://", "postgres://"):
            if url.startswith(prefix):
                return url.replace(prefix, "postgresql+asyncpg://", 1)
        return url
    redis_url: str = "redis://localhost:6379/0"
    s3_bucket: str = "math-hub-test1"
    s3_region: str = "ap-northeast-2"
    s3_access_key_id: str = ""
    s3_secret_access_key: str = ""
    mathpix_app_id: str = ""
    mathpix_app_key: str = ""
    mathpix_base_url: str = "https://api.mathpix.com/v3"
    ai_api_key: str = ""
    ai_api_base_url: str = "https://api.openai.com/v1"
    ai_model: str = "gpt-5-mini"
    celery_worker_concurrency: int = Field(default=4, ge=1)
    use_unified_analysis: bool = True

    model_config = {"env_file": "../../.env", "extra": "ignore"}


settings = Settings()
