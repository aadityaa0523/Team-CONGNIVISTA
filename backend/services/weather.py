import logging

import httpx

from backend.config import settings

logger = logging.getLogger(__name__)

_FORECAST_URL = "https://api.openweathermap.org/data/2.5/forecast"


def get_rainfall_forecast(lat: float, lon: float) -> list[float]:
    """Return approx hourly precipitation_mm for the next 4 hours (4 floats, oldest first).

    Uses OWM 2.5 /forecast (free tier). Each OWM entry covers 3 h; values are divided
    by 3 for an hourly approximation and duplicated into two 30-min slots.
    Falls back to zeros when OWM_API_KEY is absent or the call fails.
    """
    if not settings.owm_api_key:
        logger.warning("OWM_API_KEY not configured — returning zero rainfall forecast")
        return [0.0, 0.0, 0.0, 0.0]

    try:
        resp = httpx.get(
            _FORECAST_URL,
            params={
                "lat": lat,
                "lon": lon,
                "cnt": 2,           # next two 3-hour slots ≈ 6 h coverage
                "appid": settings.owm_api_key,
                "units": "metric",
            },
            timeout=10,
        )
        resp.raise_for_status()
        hourly: list[float] = []
        for entry in resp.json().get("list", [])[:2]:
            rain_per_hour = entry.get("rain", {}).get("3h", 0.0) / 3.0
            hourly.extend([rain_per_hour, rain_per_hour])  # spread into two 30-min slots
        return (hourly + [0.0, 0.0, 0.0, 0.0])[:4]
    except Exception as exc:
        logger.warning("OWM forecast request failed (%s) — using zeros", exc)
        return [0.0, 0.0, 0.0, 0.0]


def get_historical_rainfall(lat: float, lon: float, hours: int = 48) -> list[float]:
    """Return hourly precipitation_mm for the past `hours` hours (oldest first).

    OWM timemachine requires a paid subscription; returns zeros as a safe training
    default so the ARIMAX model degrades gracefully to ARIMA when rainfall is unavailable.
    """
    return [0.0] * hours
