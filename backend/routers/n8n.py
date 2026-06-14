"""n8n webhook integration — test endpoint and manual trigger."""
import logging
from datetime import UTC, datetime

import httpx
from fastapi import APIRouter, HTTPException

from backend.config import settings

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/test")
async def test_webhook():
    """Fire a test payload to N8N_WEBHOOK_URL to verify the workflow is connected."""
    if not settings.n8n_webhook_url:
        raise HTTPException(status_code=400, detail="N8N_WEBHOOK_URL is not configured in .env")

    payload = {
        "tank_id": "krishna_river_01",
        "water_level": 15.0,
        "location": "KPHB Phase 4 Street 6",
        "timestamp": datetime.now(UTC).isoformat(),
        "flood_level": "RED",
        "risk_class": "CRITICAL",
        "time_to_flood_min": 12,
        "briefing": "HydroMind test alert — water level critically high.",
    }

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(settings.n8n_webhook_url, json=payload, timeout=15)
        # n8n test webhooks return 400 even on success — treat it as ok.
        return {"status": "ok", "n8n_status_code": resp.status_code, "payload_sent": payload}
    except Exception as exc:
        logger.warning("n8n webhook failed: %s", exc)
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/trigger")
async def trigger_alert(node_id: str = "krishna_river_01"):
    """Manually push the latest alert data for a node to n8n."""
    if not settings.n8n_webhook_url:
        raise HTTPException(status_code=400, detail="N8N_WEBHOOK_URL is not configured in .env")

    from backend.services import influx
    distance_cm = influx.get_latest(node_id)
    payload = {
        "type": "manual_trigger",
        "node_id": node_id,
        "distance_cm": distance_cm,
        "ts": datetime.now(UTC).isoformat(),
    }

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(settings.n8n_webhook_url, json=payload, timeout=15)
        return {"status": "ok", "n8n_status_code": resp.status_code}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
