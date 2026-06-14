"""Digital twin score computation for urban drain assets.

All scoring functions are pure calculations — no I/O. They are called by the
scheduler's update_all_drain_scores() job and by the alert engine.
"""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def compute_fill_pct(current_level_cm: float, capacity_cm: float) -> float:
    """Percentage of drain capacity currently used (0–100)."""
    if capacity_cm <= 0:
        return 0.0
    return round(min(100.0, max(0.0, current_level_cm / capacity_cm * 100)), 1)


def compute_stress_index(
    fill_pct: float,
    rise_rate_cm_per_min: float,
    rainfall_mm: float,
    methane_ppm: float,
) -> int:
    """Operational stress score 0–100.

    Weighted: fill_pct (40%) · rise_rate (30%) · rainfall (20%) · methane (10%)
    """
    w_fill = min(1.0, fill_pct / 100.0) * 40
    w_rise = min(1.0, rise_rate_cm_per_min / 10.0) * 30
    w_rain = min(1.0, rainfall_mm / 50.0) * 20
    w_ch4 = min(1.0, methane_ppm / 1000.0) * 10
    return round(w_fill + w_rise + w_rain + w_ch4)


def stress_category(stress_index: int) -> str:
    """SAFE / WATCH / WARNING / CRITICAL from a stress score."""
    if stress_index >= 75:
        return "CRITICAL"
    if stress_index >= 50:
        return "WARNING"
    if stress_index >= 25:
        return "WATCH"
    return "SAFE"


def compute_health_score(
    alert_count: int,
    flood_event_count: int,
    avg_recovery_min: float,
) -> int:
    """Infrastructure health 0–100 (higher = healthier).

    Penalises frequent alerts, flood events, and slow recoveries.
    """
    alert_penalty = min(30, alert_count * 3)
    flood_penalty = min(40, flood_event_count * 8)
    recovery_penalty = min(30, avg_recovery_min / 10)
    return max(0, 100 - alert_penalty - flood_penalty - int(recovery_penalty))


def health_label(score: int) -> str:
    if score >= 70:
        return "Healthy"
    if score >= 40:
        return "Stressed"
    return "Critical"


def compute_urban_risk(flood_risk_pct: float, sewer_risk_pct: float) -> int:
    """Combined urban risk 0–100. Flood risk weighted 70%, sewer 30%."""
    return round(min(100.0, flood_risk_pct * 0.70 + sewer_risk_pct * 0.30))


def compute_criticality(
    population_served: int,
    infrastructure_count: int,
    flood_event_count: int,
) -> int:
    """Drain criticality 0–100 based on population served, infrastructure, and history."""
    pop_score = min(50, population_served / 1000)      # 50k people = max score
    infra_score = min(30, infrastructure_count * 10)   # 3 critical infra = max
    history_score = min(20, flood_event_count * 4)     # 5 past events = max
    return round(pop_score + infra_score + history_score)


def prioritize_drains(drain_list: list[dict]) -> list[dict]:
    """Sort drains by descending urgency using risk_score, then stress_index."""
    return sorted(
        drain_list,
        key=lambda d: (d.get("risk_score", 0), d.get("stress_index", 0)),
        reverse=True,
    )


async def update_all_drain_scores() -> None:
    """Recalculate and persist scores for every drain in the digital twin.

    Called by the scheduler every 5 minutes.
    """
    from backend.services import influx, mongo

    drains = await mongo.list_drains()
    if not drains:
        return

    for drain in drains:
        drain_id = drain.get("drain_id", "")
        if not drain_id:
            continue

        try:
            current_wl = influx.get_latest(drain_id)
            if current_wl is None:
                continue

            capacity = drain.get("capacity_cm", 100)
            fill = compute_fill_pct(current_wl, capacity)

            methane = influx.get_latest_methane(drain_id) or 0.0
            stress = compute_stress_index(fill, 0.0, 0.0, methane)
            urban_risk = compute_urban_risk(fill, min(100, methane / 10))

            alert_count = await mongo.count_alerts(drain_id)
            health = compute_health_score(alert_count, 0, 0.0)

            updates = {
                "current_water_level_cm": current_wl,
                "fill_pct": fill,
                "stress_index": stress,
                "stress_category": stress_category(stress),
                "health_score": health,
                "health_label": health_label(health),
                "risk_score": urban_risk,
            }
            await mongo.upsert_drain(drain_id, updates)
        except Exception as exc:
            logger.warning("Failed to update scores for drain '%s': %s", drain_id, exc)
