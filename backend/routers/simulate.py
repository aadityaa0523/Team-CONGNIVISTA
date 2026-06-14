from fastapi import APIRouter
from pydantic import BaseModel

from backend.services import classifier

router = APIRouter()


class SimulateRequest(BaseModel):
    """What-If inputs. Defaults mirror a moderately stressed drain."""
    water_level_cm: float = 60.0
    capacity_cm: float = 100.0
    rise_rate_cm_per_min: float = 0.5
    methane_ppm: float = 100.0
    rainfall_mm: float = 5.0
    hour_of_day: int = 12


@router.post("")
def simulate(req: SimulateRequest):
    """Run the ML models against hypothetical inputs (Feature 38 — What-If).

    Returns flood risk class, time-to-flood, recovery estimate, and anomaly flag.
    """
    fill_pct = (
        min(100.0, max(0.0, req.water_level_cm / req.capacity_cm * 100))
        if req.capacity_cm > 0
        else 0.0
    )
    features = {
        "water_level_cm": req.water_level_cm,
        "fill_pct": fill_pct,
        "rise_rate_cm_per_min": req.rise_rate_cm_per_min,
        "methane_ppm": req.methane_ppm,
        "rainfall_mm": req.rainfall_mm,
        "hour_of_day": float(req.hour_of_day),
    }

    risk = classifier.predict_flood_risk(features)
    ttf = classifier.predict_ttf(features)
    recovery = classifier.predict_recovery(features)
    anomaly, reason = classifier.detect_anomaly(features)

    return {
        "inputs": features,
        "fill_pct": round(fill_pct, 1),
        "flood_risk": risk,
        "time_to_flood_min": ttf,
        "recovery_min": recovery,
        "anomaly": {"detected": anomaly, "reason": reason},
    }
