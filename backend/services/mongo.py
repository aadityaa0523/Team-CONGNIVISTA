import json
import logging
from pathlib import Path

from motor.motor_asyncio import AsyncIOMotorClient

from backend.config import settings

logger = logging.getLogger(__name__)

_client: AsyncIOMotorClient | None = None

_DRAIN_SEED_PATH = Path(__file__).resolve().parents[2] / "data" / "synthetic_drain_profiles.json"


def _db():
    global _client
    if _client is None:
        _client = AsyncIOMotorClient(settings.mongo_uri)
    return _client[settings.mongo_db]


async def insert_alert(alert_doc: dict) -> None:
    doc = {k: v for k, v in alert_doc.items() if k != "_id"}
    await _db()["alerts"].insert_one(doc)


async def get_alerts(node_id: str, limit: int = 50) -> list[dict]:
    cursor = (
        _db()["alerts"]
        .find({"node_id": node_id}, {"_id": 0})
        .sort("ts", -1)
        .limit(limit)
    )
    return await cursor.to_list(length=limit)


async def get_subscribers(node_id: str) -> list[str]:
    """Return phone numbers subscribed to alerts for this node.

    Subscriber documents: { phone: "+91...", node_ids: ["krishna_river_01", ...] }
    """
    cursor = _db()["subscribers"].find(
        {"node_ids": node_id},
        {"phone": 1, "_id": 0},
    )
    docs = await cursor.to_list(length=500)
    return [d["phone"] for d in docs if "phone" in d]


async def count_alerts(node_id: str) -> int:
    """Return the total number of alerts ever logged for a node."""
    return await _db()["alerts"].count_documents({"node_id": node_id})


# ── Digital Twin — Drain CRUD ─────────────────────────────────────────────────

async def upsert_drain(drain_id: str, data: dict) -> None:
    """Insert or update a drain document. drain_id is the unique key."""
    doc = {k: v for k, v in data.items() if k != "_id"}
    doc["drain_id"] = drain_id
    await _db()["drains"].update_one(
        {"drain_id": drain_id},
        {"$set": doc},
        upsert=True,
    )


async def get_drain(drain_id: str) -> dict | None:
    return await _db()["drains"].find_one({"drain_id": drain_id}, {"_id": 0})


async def list_drains() -> list[dict]:
    cursor = _db()["drains"].find({}, {"_id": 0}).sort("drain_id", 1)
    return await cursor.to_list(length=500)


async def seed_drains_if_empty() -> int:
    """Pre-populate the drains collection from synthetic_drain_profiles.json
    when it is empty (Phase 4 requirement). Idempotent: a no-op once any drain
    exists. Returns the number of drains inserted.
    """
    coll = _db()["drains"]
    if await coll.count_documents({}) > 0:
        return 0
    if not _DRAIN_SEED_PATH.exists():
        logger.warning("Drain seed file not found at %s — skipping seed", _DRAIN_SEED_PATH)
        return 0

    with open(_DRAIN_SEED_PATH, "r", encoding="utf-8") as f:
        drains = json.load(f)

    for drain in drains:
        await upsert_drain(drain["drain_id"], drain)
    logger.info("Seeded %d drain profiles into MongoDB", len(drains))
    return len(drains)


# ── Incident Center ────────────────────────────────────────────────────────────

async def insert_incident(incident_doc: dict) -> None:
    doc = {k: v for k, v in incident_doc.items() if k != "_id"}
    await _db()["incidents"].insert_one(doc)


async def get_incidents(limit: int = 100) -> list[dict]:
    cursor = (
        _db()["incidents"]
        .find({}, {"_id": 0})
        .sort("ts", -1)
        .limit(limit)
    )
    return await cursor.to_list(length=limit)


# ── Community Reports (citizen-submitted) ──────────────────────────────────────

async def insert_report(report_doc: dict) -> str:
    """Store a citizen community report; returns the new document id as a string."""
    doc = {k: v for k, v in report_doc.items() if k != "_id"}
    result = await _db()["community_reports"].insert_one(doc)
    return str(result.inserted_id)


async def get_reports(limit: int = 100, status: str | None = None) -> list[dict]:
    query = {"status": status} if status else {}
    cursor = (
        _db()["community_reports"]
        .find(query, {"_id": 0})
        .sort("ts", -1)
        .limit(limit)
    )
    return await cursor.to_list(length=limit)


# ── Citizen profiles ───────────────────────────────────────────────────────────

async def upsert_citizen(phone: str, data: dict) -> None:
    doc = {k: v for k, v in data.items() if k != "_id"}
    doc["phone"] = phone
    await _db()["citizens"].update_one({"phone": phone}, {"$set": doc}, upsert=True)
