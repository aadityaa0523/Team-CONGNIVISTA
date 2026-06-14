"""Community reporting — citizens submit waterlogging / blocked-drain / help requests.

Primary store is MongoDB Atlas (`community_reports`). If Mongo is unreachable
(e.g. offline demo), reports fall back to an in-process list so the feature keeps
working end-to-end on the dashboard map.
"""
import logging
import time
import uuid

from fastapi import APIRouter
from pydantic import BaseModel, Field

from backend.services import mongo

logger = logging.getLogger(__name__)
router = APIRouter()

# In-memory fallback (also mirrors successful Mongo writes for instant reads).
_FALLBACK: list[dict] = []

_VALID_TYPES = {
    "waterlogging",
    "blocked_drain",
    "need_help",
    "flooding",
    "unsafe_condition",
}


class ReportIn(BaseModel):
    type: str = Field(..., description="waterlogging | blocked_drain | need_help | flooding | unsafe_condition")
    description: str = ""
    area: str = ""
    lat: float | None = None
    lon: float | None = None
    reporter_name: str = ""
    reporter_phone: str = ""
    severity: str = "medium"  # low | medium | high


@router.post("")
async def submit_report(body: ReportIn):
    report = body.model_dump()
    report["id"] = uuid.uuid4().hex[:12]
    report["ts"] = int(time.time() * 1000)
    report["status"] = "open"
    if report["type"] not in _VALID_TYPES:
        report["type"] = "unsafe_condition"

    # Keep a local copy so the map updates immediately regardless of Mongo latency.
    _FALLBACK.insert(0, report)
    del _FALLBACK[200:]

    try:
        await mongo.insert_report(report)
        report["stored"] = "mongodb"
    except Exception as exc:  # noqa: BLE001 — demo resilience
        logger.warning("Mongo insert_report failed, kept in-memory only (%s)", exc)
        report["stored"] = "memory"

    return {"status": "ok", "report": report}


@router.get("")
async def list_reports(limit: int = 100):
    try:
        docs = await mongo.get_reports(limit=limit)
        if docs:
            return {"reports": docs, "source": "mongodb"}
    except Exception as exc:  # noqa: BLE001
        logger.warning("Mongo get_reports failed, serving in-memory (%s)", exc)
    return {"reports": _FALLBACK[:limit], "source": "memory"}
