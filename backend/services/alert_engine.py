"""Alert engine — evaluates flood and sewer risk, dispatches coordinated alerts.

The `evaluate(node_id)` coroutine is called by the APScheduler every 30 seconds
for each known node. It is idempotent and fully debounced.
"""
import json
import logging
from datetime import UTC, datetime, timedelta

import httpx

from backend.config import settings
from backend.services import (
    classifier,
    forecaster,
    gemini,
    influx,
    mongo,
    sarvam,
    sewer_safety,
    twilio_sms,
    weather,
)
from backend.websocket_manager import manager

# Lat/lng for each monitored node — used for live OWM rainfall lookup
_NODE_COORDS: dict[str, tuple[float, float]] = {
    "krishna_river_01":  (16.5062, 80.648),
    "godavari_river_01": (17.0005, 81.804),
    "hussain_sagar_01":  (17.3850, 78.488),
    "himayat_sagar_01":  (17.3141, 78.392),
}

logger = logging.getLogger(__name__)

# ── Debounce state ────────────────────────────────────────────────────────────
# Stores {node_id: (level, last_broadcast_ts)} to prevent spam alerts.
_last_alert: dict[str, tuple[str, datetime]] = {}
_DEBOUNCE_MINUTES = 15

# ── Node language mapping ─────────────────────────────────────────────────────
_TAMIL_KEYWORDS = {"chennai", "anna_nagar", "drain", "ta_"}


def _node_language(node_id: str) -> str:
    nid = node_id.lower()
    if any(k in nid for k in _TAMIL_KEYWORDS):
        return sarvam.LANG_TAMIL
    return sarvam.LANG_TELUGU  # default for AP / Telangana nodes


# ── Flood level classification ────────────────────────────────────────────────

def classify_flood(distance_cm: float, forecast: list[dict]) -> str:
    """Return "green" | "yellow" | "orange" | "red".

    Checks both the current reading and the worst 2-hour forecast value.
    """
    forecast_min = min(
        (s["distance_cm_predicted"] for s in forecast),
        default=distance_cm,
    )

    for level, threshold in (
        ("red", settings.alert_red_cm),
        ("orange", settings.alert_orange_cm),
        ("yellow", settings.alert_yellow_cm),
    ):
        if distance_cm <= threshold or forecast_min <= threshold:
            return level

    return "green"


def _is_debounced(node_id: str, level: str) -> bool:
    if node_id not in _last_alert:
        return False
    last_level, last_ts = _last_alert[node_id]
    if last_level != level:
        return False
    return datetime.now(UTC) - last_ts < timedelta(minutes=_DEBOUNCE_MINUTES)


def _compute_rise_rate(readings_df) -> float:
    """Rise rate in cm/min; positive means water level is rising."""
    if readings_df is None or len(readings_df) < 2:
        return 0.0
    recent = readings_df.tail(10)
    if len(recent) < 2:
        return 0.0
    t_diff = (recent["time"].iloc[-1] - recent["time"].iloc[0]).total_seconds() / 60
    if t_diff <= 0:
        return 0.0
    d_diff = recent["distance_cm"].iloc[-1] - recent["distance_cm"].iloc[0]
    return round(-d_diff / t_diff, 4)  # negative diff → water rising → positive rate


def _build_alert_message(
    node_id: str,
    flood_level: str,
    sewer: dict,
    ttf: float,
    distance_cm: float,
    forecast: list[dict],
) -> str:
    forecast_cm = forecast[-1]["distance_cm_predicted"] if forecast else distance_cm
    parts = [f"HydroMind Alert — {node_id.replace('_', ' ').title()}"]
    if flood_level != "green":
        parts.append(
            f"Flood level: {flood_level.upper()}. "
            f"Current: {distance_cm:.0f} cm. "
            f"Forecast (2h): {forecast_cm:.0f} cm."
        )
        if ttf < 120:
            parts.append(f"Estimated time to overflow: {ttf:.0f} minutes.")
    if sewer_safety.is_hazardous(sewer):
        parts.append(
            f"Sewer hazard: {sewer['sewer_safety_index']}. "
            f"Methane: {sewer['methane_ppm']:.0f} ppm. "
            f"{sewer['worker_clearance']}."
        )
    return " ".join(parts)


def _upload_to_storage(_audio_bytes: bytes) -> str:
    """Stub — Phase 9 will upload to Vultr Object Storage and return a public URL."""
    return ""


_NODE_LABELS: dict[str, str] = {
    "krishna_river_01":  "KPHB Phase 4 Street 6",
    "godavari_river_01": "Godavari Bund Road, Rajahmundry",
    "hussain_sagar_01":  "Hussain Sagar Basin, Hyderabad",
    "himayat_sagar_01":  "Himayat Sagar Catchment, Hyderabad",
}


def _fire_n8n(alert_doc: dict) -> None:
    if not settings.n8n_webhook_url:
        return
    node = alert_doc.get("node_id", "unknown")
    dist = float(alert_doc.get("distance_cm") or 300)
    level = alert_doc.get("flood_level", "green").upper()
    risk = alert_doc.get("risk_class", "SAFE")
    ttf = alert_doc.get("time_to_flood_min")
    location = _NODE_LABELS.get(node, node)

    # n8n workflow validates tank_id, water_level, location.
    # water_level sent as distance_cm so n8n Check Critical Level (< 40) matches our RED threshold.
    payload = {
        "tank_id": node,
        "water_level": dist,
        "location": location,
        "timestamp": alert_doc.get("ts", ""),
        "flood_level": level,
        "risk_class": risk,
        "time_to_flood_min": ttf,
        "briefing": alert_doc.get("briefing", ""),
    }
    try:
        httpx.post(settings.n8n_webhook_url, json=payload, timeout=5)
        logger.info("n8n webhook fired for %s (level=%s dist=%.1f)", node, level, dist)
    except Exception as exc:
        logger.warning("n8n webhook failed: %s", exc)


# ── Main evaluation coroutine ─────────────────────────────────────────────────

async def evaluate(node_id: str) -> None:
    """Full alert pipeline for one node. Called every 30 s by APScheduler.

    Steps:
    1. Fetch latest water level + methane from InfluxDB.
    2. Run ARIMAX forecast (skips gracefully if model not trained yet).
    3. Classify flood level + sewer safety.
    4. Early-exit if both are green/safe.
    5. Debounce — skip if same level broadcast within last 15 min.
    6. Translate alert, generate TTS audio, get Gemini briefing + XAI.
    7. Persist alert to MongoDB.
    8. Dispatch SMS / voice (red only) / n8n / WebSocket.
    """
    # 1 — Sensor readings
    distance_cm = influx.get_latest(node_id)
    if distance_cm is None:
        return  # no data yet for this node

    methane_ppm = influx.get_latest_methane(node_id) or 0.0
    readings_df = influx.query_readings(node_id, hours=6)

    # 2 — Live rainfall from OWM, then forecast (best-effort)
    lat, lon = _NODE_COORDS.get(node_id, (17.385, 78.488))
    rainfall_slots = weather.get_rainfall_forecast(lat, lon)   # 4 × 30-min slots
    rainfall_1h = rainfall_slots[0] + rainfall_slots[1]
    rainfall_3h = sum(rainfall_slots)

    forecast: list[dict] = []
    try:
        forecast = forecaster.predict(node_id, rainfall_1h=rainfall_1h, rainfall_3h=rainfall_3h,
                                      methane_ppm=methane_ppm)
    except FileNotFoundError:
        logger.debug("No trained model for '%s' — forecast skipped", node_id)
    except Exception as exc:
        logger.warning("Forecast failed for '%s': %s", node_id, exc)

    # 3 — Classification
    flood_level = classify_flood(distance_cm, forecast)
    sewer = sewer_safety.evaluate_sewer(node_id, methane_ppm)

    # 4 — Early exit
    if flood_level == "green" and not sewer_safety.is_hazardous(sewer):
        return

    # 5 — Debounce
    combined_level = f"{flood_level}|{sewer['sewer_safety_index']}"
    if _is_debounced(node_id, combined_level):
        logger.debug("Alert for '%s' debounced (level=%s)", node_id, combined_level)
        return

    _last_alert[node_id] = (combined_level, datetime.now(UTC))

    # 6 — ML features
    rise_rate = _compute_rise_rate(readings_df)
    fill_pct = max(0.0, min(100.0, (100 - distance_cm)))  # simplified for river nodes
    features = {
        "water_level_cm": distance_cm,
        "fill_pct": fill_pct,
        "rise_rate_cm_per_min": rise_rate,
        "methane_ppm": methane_ppm,
        "rainfall_mm": 0.0,
        "hour_of_day": float(datetime.now(UTC).hour),
    }

    risk_result = classifier.predict_flood_risk(features)
    ttf = classifier.predict_ttf(features)
    is_anomaly, anomaly_cause = classifier.detect_anomaly(features)
    xai = gemini.explain_prediction(features, risk_result["class"])

    # 7 — Multilingual alert message
    lang = _node_language(node_id)
    msg_en = _build_alert_message(node_id, flood_level, sewer, ttf, distance_cm, forecast)
    msg_local = sarvam.translate(msg_en, target_lang=lang)
    audio_bytes = sarvam.text_to_speech(msg_local, lang=lang)
    audio_url = _upload_to_storage(audio_bytes)

    # 8 — Gemini briefing + AI analysis
    briefing = gemini.generate_briefing(node_id, readings_df, forecast)
    ai_analysis = gemini.generate_ai_analysis(node_id, features)

    # 9 — Persist alert
    alert_doc = {
        "node_id": node_id,
        "flood_level": flood_level,
        "distance_cm": distance_cm,
        "forecast_cm": forecast[-1]["distance_cm_predicted"] if forecast else None,
        "methane_ppm": methane_ppm,
        "sewer_safety": sewer,
        "risk_class": risk_result["class"],
        "risk_probability": risk_result["probability"],
        "time_to_flood_min": ttf,
        "anomaly": {"detected": is_anomaly, "cause": anomaly_cause},
        "ts": datetime.now(UTC).isoformat(),
        "briefing": briefing,
        "ai_analysis": ai_analysis,
        "xai_explanation": xai,
        "sarvam_audio_url": audio_url,
    }
    await mongo.insert_alert(alert_doc)

    # 10 — Broadcast
    subscribers = await mongo.get_subscribers(node_id)
    for phone in subscribers:
        twilio_sms.send_sms(phone, msg_local)
        if flood_level == "red":
            twilio_sms.make_voice_call(phone, msg_en)

    _fire_n8n(alert_doc)
    await manager.broadcast(json.dumps({"type": "alert", **alert_doc}))

    logger.info(
        "Alert dispatched for '%s': flood=%s sewer=%s risk=%s ttf=%.0f min",
        node_id, flood_level, sewer["sewer_safety_index"], risk_result["class"], ttf,
    )
