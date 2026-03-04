from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import settings

engine = create_async_engine(settings.async_database_url, echo=False, pool_size=10, max_overflow=20)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def get_db() -> AsyncSession:  # type: ignore[misc]
    async with async_session() as session:
        yield session


_worker_engine = None


@asynccontextmanager
async def worker_session():
    """Create an async session for Celery workers.

    Uses a cached engine with NullPool. NullPool creates a new connection
    per checkout and closes it on checkin, so there's no connection pooling
    state that could conflict across asyncio.run() calls.
    """
    global _worker_engine
    if _worker_engine is None:
        _worker_engine = create_async_engine(
            settings.async_database_url, poolclass=NullPool
        )
    factory = async_sessionmaker(
        _worker_engine, class_=AsyncSession, expire_on_commit=False
    )
    async with factory() as session:
        yield session
