from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/jsmath"
    redis_url: str = "redis://localhost:6379/0"
    s3_bucket: str = "jsmath-assets"
    mathpix_app_id: str = ""
    mathpix_app_key: str = ""
    openai_api_key: str = ""

    model_config = {"env_prefix": "JSMATH_"}


settings = Settings()
