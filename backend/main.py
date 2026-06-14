import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from backend import mqtt_client, scheduler
from backend.routers import ai, alerts, chat, drains, forecast, methane, model, n8n, readings, reports, simulate, tts
from backend.services import mongo
from backend.websocket_manager import manager

logging.basicConfig(level=logging.INFO)

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    loop = asyncio.get_running_loop()
    manager.set_loop(loop)
    scheduler.set_loop(loop)

    # Pre-populate digital twin drains on first boot (Phase 4).
    try:
        await mongo.seed_drains_if_empty()
    except Exception as exc:  # MongoDB unreachable — don't block startup
        logger.warning("Drain seeding skipped: %s", exc)

    mqtt_client.start()
    scheduler.start()
    yield
    mqtt_client.stop()
    scheduler.stop()


app = FastAPI(title="HydroMind API", version="0.2.0", lifespan=lifespan)

app.include_router(readings.router, prefix="/readings", tags=["readings"])
app.include_router(forecast.router, prefix="/forecast", tags=["forecast"])
app.include_router(alerts.router, prefix="/alerts", tags=["alerts"])
app.include_router(chat.router, prefix="/chat", tags=["chat"])
app.include_router(drains.router, prefix="/drains", tags=["drains"])
app.include_router(methane.router, prefix="/methane", tags=["methane"])
app.include_router(model.router, prefix="/model", tags=["model"])
app.include_router(simulate.router, prefix="/simulate", tags=["simulate"])
app.include_router(reports.router, prefix="/reports", tags=["reports"])
app.include_router(ai.router, prefix="/ai", tags=["ai"])
app.include_router(tts.router, prefix="/tts", tags=["tts"])
app.include_router(n8n.router, prefix="/n8n", tags=["n8n"])


@app.get("/health")
def health():
    return {"status": "ok"}


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await manager.connect(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(ws)
