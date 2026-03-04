from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import settings

engine = create_async_engine(settings.async_database_url, echo=False, pool_size=10, max_overflow=20)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def get_db() -> AsyncSession:  # type: ignore[misc]
    async with async_session() as session:
        yield session


@asynccontextmanager
async def worker_session():
    """Create a fresh async session for Celery workers.

    Each asyncio.run() call creates a new event loop, so we need a fresh
    engine with NullPool to avoid event-loop binding issues with asyncpg.
    """
    eng = create_async_engine(settings.async_database_url, poolclass=NullPool)
    factory = async_sessionmaker(eng, class_=AsyncSession, expire_on_commit=False)
    async with factory() as session:
        yield session
    await eng.dispose()
