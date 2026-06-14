from fastapi import APIRouter, Query

from backend.services import mongo

router = APIRouter()


@router.get("/{node_id}")
async def get_alerts(node_id: str, limit: int = Query(50, ge=1, le=200)):
    return await mongo.get_alerts(node_id, limit=limit)
