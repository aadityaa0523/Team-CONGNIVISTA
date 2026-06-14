"""Gemini-powered AI endpoints — citizen situation summaries & admin XAI analysis."""
import logging

from fastapi import APIRouter

from backend.services import forecaster, gemini, influx

logger = logging.getLogger(__name__)
router = APIRouter()


def _risk_from_distance(distance_cm: float) -> str:
    if distance_cm <= 40:
        return "CRITICAL"
    if distance_cm <= 60:
        return "WARNING"
    if distance_cm <= 80:
        return "WATCH"
    return "SAFE"


@router.get("/briefing/{node_id}")
async def briefing(node_id: str):
    """Return a citizen-friendly situation summary for a node.

    Always returns 200 with a usable summary — Gemini when available, otherwise a
    deterministic template built from live readings + forecast.
    """
    df = influx.query_readings(node_id, hours=6)
    current = float(df["distance_cm"].iloc[-1]) if not df.empty else None
    trend = "stable"
    if not df.empty and len(df) >= 2:
        trend = "rising" if df["distance_cm"].iloc[-1] < df["distance_cm"].iloc[0] else "receding"

    forecast: list[dict] = []
    try:
        forecast = forecaster.predict(node_id)
    except Exception as exc:  # noqa: BLE001
        logger.info("Forecast unavailable for briefing (%s)", exc)

    risk = _risk_from_distance(current) if current is not None else "UNKNOWN"

    summary = ""
    try:
        summary = gemini.generate_briefing(node_id, df, forecast)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Gemini briefing failed (%s)", exc)

    return {
        "node_id": node_id,
        "risk": risk,
        "trend": trend,
        "current_distance_cm": current,
        "forecast": forecast,
        "summary": summary,
    }


@router.get("/analysis/{node_id}")
async def analysis(node_id: str):
    """Structured XAI analysis for the admin anomaly / decision-assistant pages."""
    df = influx.query_readings(node_id, hours=6)
    current = float(df["distance_cm"].iloc[-1]) if not df.empty else None
    metrics = {
        "node_id": node_id,
        "current_distance_cm": current,
        "risk": _risk_from_distance(current) if current is not None else "UNKNOWN",
        "readings_count": int(len(df)),
    }
    try:
        result = gemini.generate_ai_analysis(node_id, metrics)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Gemini analysis failed (%s)", exc)
        result = {"summary": "", "risk_explanation": "", "root_cause": [], "recommendations": []}
    return {"node_id": node_id, **result, "metrics": metrics}
