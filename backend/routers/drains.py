from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.services import digital_twin, mongo

router = APIRouter()


class DrainUpsert(BaseModel):
    name: str = ""
    location: dict = {}
    ward: str = ""
    capacity_cm: float = 100.0
    overflow_threshold_cm: float = 85.0
    population_served: int = 0
    infrastructure_nearby: list[str] = []


@router.get("")
async def list_drains():
    """Return all digital twin drain profiles, sorted by priority."""
    drains = await mongo.list_drains()
    return {"drains": digital_twin.prioritize_drains(drains)}


@router.get("/{drain_id}")
async def get_drain(drain_id: str):
    drain = await mongo.get_drain(drain_id)
    if not drain:
        raise HTTPException(status_code=404, detail=f"Drain '{drain_id}' not found.")
    return drain


@router.put("/{drain_id}")
async def upsert_drain(drain_id: str, body: DrainUpsert):
    """Create or update a drain profile."""
    await mongo.upsert_drain(drain_id, body.model_dump())
    return {"status": "ok", "drain_id": drain_id}


@router.delete("/{drain_id}")
async def delete_drain(drain_id: str):
    result = await mongo._db()["drains"].delete_one({"drain_id": drain_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail=f"Drain '{drain_id}' not found.")
    return {"status": "deleted", "drain_id": drain_id}


@router.get("/incidents/recent")
async def get_recent_incidents(limit: int = 50):
    incidents = await mongo.get_incidents(limit=limit)
    return {"incidents": incidents}
