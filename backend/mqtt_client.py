import json
import logging
import os
import sys
from pathlib import Path

import paho.mqtt.client as mqtt

from backend.config import settings
from backend.services import influx
from backend.websocket_manager import manager

# Load the Sentinel engine once at import time.
# The sentinel/ directory is a sibling of backend/ so add the project root.
_PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_PROJECT_ROOT / "sentinel"))

try:
    from hydromind_live_engine import HydroMindSentinel  # type: ignore
    _sentinel = HydroMindSentinel()
    logger_init = logging.getLogger(__name__)
    logger_init.info("HydroMind Sentinel engine loaded.")
except Exception as _e:
    _sentinel = None
    logging.getLogger(__name__).warning("Sentinel engine unavailable: %s", _e)

logger = logging.getLogger(__name__)

_client: mqtt.Client | None = None


def _run_sentinel(node_id: str, payload: dict) -> None:
    """Run the Sentinel engine on a live water-level reading and broadcast the result."""
    if _sentinel is None:
        return
    try:
        result = _sentinel.predict(
            current_time=payload["ts"],
            water_level=float(payload["distance_cm"]),
            methane_ppm=float(payload.get("methane_ppm", 0)),
            rainfall_1h=float(payload.get("rainfall_1h", 0)),
            rainfall_3h=float(payload.get("rainfall_3h", 0)),
        )
        result["node_id"] = node_id
        result["type"] = "risk_assessment"
        manager.broadcast_from_thread(json.dumps(result))
        logger.info(
            "Sentinel [%s] → risk=%s conf=%.2f wl@+60m=%.1f",
            node_id, result["predicted_risk"], result["confidence"],
            result["predicted_water_level_60min"],
        )
    except Exception as exc:
        logger.warning("Sentinel prediction failed for %s: %s", node_id, exc)


def _on_connect(client: mqtt.Client, userdata, flags, rc: int) -> None:
    if rc == 0:
        logger.info("MQTT connected to %s:%s", settings.mqtt_broker_host, settings.mqtt_broker_port)
        client.subscribe(settings.mqtt_topic)
        logger.info("Subscribed to %s", settings.mqtt_topic)
    else:
        logger.error("MQTT connection failed (rc=%s)", rc)


def _on_disconnect(client: mqtt.Client, userdata, rc: int) -> None:
    logger.warning("MQTT disconnected (rc=%s)", rc)


def _on_message(client: mqtt.Client, userdata, msg: mqtt.MQTTMessage) -> None:
    try:
        raw = msg.payload if isinstance(msg.payload, bytes) else msg.payload.encode()
        payload = json.loads(raw.decode("utf-8"))
        logger.debug("MQTT message on %s: %s", msg.topic, payload)

        manager.broadcast_from_thread(json.dumps(payload))

        node_id = payload.get("node_id", "")

        # Register node so the scheduler knows which nodes are active.
        from backend import scheduler  # late import avoids circular dep at module load
        scheduler.register_node(node_id)

        if "distance_cm" in payload:
            influx.write_reading(node_id, payload["distance_cm"], payload["ts"])
            _run_sentinel(node_id, payload)
        elif "methane_ppm" in payload:
            influx.write_methane(node_id, payload["methane_ppm"], payload["ts"])
        else:
            logger.warning("Unknown payload schema on topic %s: %s", msg.topic, payload)

    except json.JSONDecodeError as e:
        logger.warning("Malformed MQTT payload on %s (raw=%r): %s", msg.topic, msg.payload, e)
    except Exception as e:
        logger.error("Error in MQTT handler (%s): %s", type(e).__name__, e, exc_info=True)


def start() -> None:
    """Start the paho-mqtt subscriber in a background thread."""
    global _client
    _client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION1, client_id=f"hydromind-backend-{os.getpid()}", clean_session=True)
    _client.on_connect = _on_connect
    _client.on_disconnect = _on_disconnect
    _client.on_message = _on_message
    _client.connect_async(settings.mqtt_broker_host, settings.mqtt_broker_port, keepalive=60)
    _client.loop_start()
    logger.info("MQTT client started (background thread)")


def stop() -> None:
    """Cleanly shut down the MQTT client."""
    if _client:
        _client.loop_stop()
        _client.disconnect()
        logger.info("MQTT client stopped")
