"""
Forecaster using pre-trained ARIMAX + XGBoost risk models.

Models expected at repo root:
  arimax_model.pkl      — ARIMAX trained on water_level, rise_rate, rainfall_1h, rainfall_3h, methane_ppm
  best_risk_model.pkl   — XGBoost classifier (SAFE/WATCH/WARNING/CRITICAL)
"""

import logging
from pathlib import Path

import joblib
import pandas as pd

from backend.services import influx

logger = logging.getLogger(__name__)

_REPO_ROOT = Path(__file__).resolve().parents[2]
_ARIMAX_PATH = _REPO_ROOT / "arimax_model.pkl"
_RISK_PATH   = _REPO_ROOT / "best_risk_model.pkl"

_RISK_LABELS = {0: "SAFE", 1: "WATCH", 2: "WARNING", 3: "CRITICAL"}
_MAX_HEIGHT  = 450.0   # sensor max range (cm); used to clamp future_level

# Per-node water history for rise-rate calculation (in-memory; resets on restart)
_history: dict[str, list[float]] = {}

_arimax_model = None
_risk_model   = None


def _load_models():
    global _arimax_model, _risk_model
    if _arimax_model is None:
        if not _ARIMAX_PATH.exists():
            raise FileNotFoundError(f"arimax_model.pkl not found at {_ARIMAX_PATH}")
        _arimax_model = joblib.load(_ARIMAX_PATH)
        logger.info("Loaded ARIMAX model from %s", _ARIMAX_PATH)
    if _risk_model is None:
        if not _RISK_PATH.exists():
            raise FileNotFoundError(f"best_risk_model.pkl not found at {_RISK_PATH}")
        _risk_model = joblib.load(_RISK_PATH)
        logger.info("Loaded risk model from %s", _RISK_PATH)


def _rise_rate(node_id: str, water_level: float) -> float:
    hist = _history.setdefault(node_id, [])
    hist.append(water_level)
    if len(hist) > 12:
        hist.pop(0)
    return hist[-1] - hist[-2] if len(hist) >= 2 else 0.0


def predict(node_id: str,
            rainfall_1h: float = 20.0,
            rainfall_3h: float = 50.0,
            methane_ppm: float = 300.0) -> list[dict]:
    """
    Return 4-step forecast dicts compatible with the existing API contract:
      [{ts, distance_cm_predicted, risk_level}, ...]

    Uses:
      - latest InfluxDB reading as current water level
      - pre-trained arimax_model.pkl for 1-step ahead
      - pre-trained best_risk_model.pkl for risk classification
    """
    _load_models()

    df = influx.query_readings(node_id, hours=1)
    if df.empty:
        raise ValueError(f"No readings in InfluxDB for node '{node_id}'.")

    water_level = float(df["distance_cm"].iloc[-1])
    rise = _rise_rate(node_id, water_level)

    exog = pd.DataFrame({
        "water_level": [water_level],
        "rise_rate":   [rise],
        "rainfall_1h": [rainfall_1h],
        "rainfall_3h": [rainfall_3h],
        "methane_ppm": [methane_ppm],
    })

    # ARIMAX 1-step ahead
    try:
        arimax_value = float(_arimax_model.forecast(steps=1, exog=exog).iloc[0])
    except Exception as e:
        logger.warning("ARIMAX forecast failed (%s); falling back to current level", e)
        arimax_value = water_level

    # Build 4 steps by projecting trend forward
    steps = []
    from datetime import datetime, timedelta, timezone
    base_ts = datetime.now(timezone.utc)

    for i in range(1, 5):
        trend   = water_level + (rise * 12 * i)           # 12 readings × i steps
        future  = (0.5 * arimax_value) + (0.5 * trend)
        future  = min(max(future, 0.0), _MAX_HEIGHT)

        X = pd.DataFrame([[water_level, future, rise, rainfall_1h, rainfall_3h, methane_ppm]],
                         columns=["water_level", "predicted_future_level",
                                  "rise_rate", "rainfall_1h", "rainfall_3h", "methane_ppm"])
        risk_idx  = int(_risk_model.predict(X)[0])
        risk_label = _RISK_LABELS.get(risk_idx, "SAFE")

        steps.append({
            "ts":                    (base_ts + timedelta(minutes=30 * i)).isoformat(),
            "distance_cm_predicted": round(future, 2),
            "risk_level":            risk_label,
        })

    return steps


def train(node_id: str) -> None:
    """
    No-op: models are pre-trained and loaded from disk.
    Reloads them from pkl files so the endpoint returns 200 instead of 422.
    """
    global _arimax_model, _risk_model
    _arimax_model = None
    _risk_model   = None
    _load_models()
    logger.info("Models reloaded from disk for node '%s'", node_id)
