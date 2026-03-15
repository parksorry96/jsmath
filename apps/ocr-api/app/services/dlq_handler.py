"""Dead-letter queue handler for failed Celery tasks.

Logs failed task info to a Redis stream for manual inspection.
Tasks are recorded when they exhaust all retries.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

import redis

from app.config import settings

logger = logging.getLogger(__name__)

DLQ_STREAM = "celery:dead_letter"
DLQ_MAX_LEN = 1000  # keep last 1000 entries


def record_dead_letter(
    task_id: str,
    task_name: str,
    args: tuple | None,
    kwargs: dict | None,
    exception: str,
    traceback_str: str | None = None,
) -> None:
    """Write a failed task entry to the Redis DLQ stream."""
    r = redis.from_url(settings.redis_url, decode_responses=True)
    try:
        entry = {
            "task_id": task_id,
            "task_name": task_name,
            "args": json.dumps(args) if args else "[]",
            "kwargs": json.dumps(kwargs) if kwargs else "{}",
            "exception": exception[:2000],
            "traceback": (traceback_str or "").split("\n")[-3:][:4000] if traceback_str else "",
            "failed_at": datetime.now(timezone.utc).isoformat(),
        }
        r.xadd(DLQ_STREAM, entry, maxlen=DLQ_MAX_LEN)
        logger.warning(
            "Dead-lettered task %s (%s): %s", task_id, task_name, exception[:200],
        )
    except Exception:
        logger.exception("Failed to write DLQ entry for task %s", task_id)
    finally:
        r.close()
