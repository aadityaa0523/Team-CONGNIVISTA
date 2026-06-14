import asyncio
import logging

from apscheduler.schedulers.background import BackgroundScheduler

logger = logging.getLogger(__name__)

_scheduler = BackgroundScheduler(timezone="UTC")
_known_nodes: set[str] = set()
_loop: asyncio.AbstractEventLoop | None = None


def set_loop(loop: asyncio.AbstractEventLoop) -> None:
    """Store the FastAPI event loop so scheduler threads can schedule async jobs on it."""
    global _loop
    _loop = loop


def register_node(node_id: str) -> None:
    """Called by mqtt_client on every incoming message to track live nodes."""
    _known_nodes.add(node_id)


def _retrain_all_nodes() -> None:
    from backend.services import forecaster  # late import avoids circular deps at startup

    for node_id in list(_known_nodes):
        try:
            forecaster.train(node_id)
            logger.info("Scheduled retrain complete for '%s'", node_id)
        except Exception as exc:
            logger.warning("Retrain skipped for '%s': %s", node_id, exc)


def _check_thresholds() -> None:
    from backend.services import alert_engine  # Phase 7 — safe to import as stub now

    if not _known_nodes or _loop is None or _loop.is_closed():
        return

    for node_id in list(_known_nodes):
        future = asyncio.run_coroutine_threadsafe(alert_engine.evaluate(node_id), _loop)
        try:
            future.result(timeout=25)
        except Exception as exc:
            logger.warning("Threshold check failed for '%s': %s", node_id, exc)


def _update_drain_scores() -> None:
    """Recalculate health/stress/risk for all digital twin drains every 5 minutes."""
    from backend.services import digital_twin  # late import

    if _loop is None or _loop.is_closed():
        return
    future = asyncio.run_coroutine_threadsafe(digital_twin.update_all_drain_scores(), _loop)
    try:
        future.result(timeout=60)
    except Exception as exc:
        logger.warning("Drain score update failed: %s", exc)


def start() -> None:
    _scheduler.add_job(_retrain_all_nodes, "interval", hours=6, id="retrain_all")
    _scheduler.add_job(_check_thresholds, "interval", seconds=30, id="check_thresholds")
    _scheduler.add_job(_update_drain_scores, "interval", minutes=5, id="update_drain_scores")
    _scheduler.start()
    logger.info("APScheduler started (retrain=6h, thresholds=30s, drain_scores=5m)")


def stop() -> None:
    if _scheduler.running:
        _scheduler.shutdown(wait=False)
        logger.info("APScheduler stopped")
