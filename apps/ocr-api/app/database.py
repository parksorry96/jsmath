from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings

engine = create_async_engine(settings.async_database_url, echo=False, pool_size=10, max_overflow=20)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def get_db() -> AsyncIterator[AsyncSession]:
    async with async_session() as session:
        yield session


import asyncio

_worker_engines: dict[int, object] = {}


@asynccontextmanager
async def worker_session() -> AsyncIterator[AsyncSession]:
    """Create an async session for Celery workers.

    Each event loop gets its own engine with a bounded pool (pool_size=5,
    max_overflow=5). This avoids event-loop mismatch errors when Celery
    tasks call asyncio.run() (which creates a new loop each time).
    With concurrency=5, max 50 connections total — well under max_connections=100.
    """
    loop = asyncio.get_running_loop()
    loop_id = id(loop)
    if loop_id not in _worker_engines:
        _worker_engines[loop_id] = create_async_engine(
            settings.async_database_url,
            pool_size=5,
            max_overflow=5,
            pool_recycle=300,
            pool_pre_ping=True,
        )
    eng = _worker_engines[loop_id]
    factory = async_sessionmaker(
        eng, class_=AsyncSession, expire_on_commit=False
    )
    async with factory() as session:
        yield session
