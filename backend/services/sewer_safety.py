"""Sewer safety evaluation based on MQ-4 methane readings."""
from backend.config import settings


def evaluate_sewer(node_id: str, methane_ppm: float) -> dict:
    """Classify methane hazard level and determine worker entry clearance.

    Returns a dict with sewer_safety_index, worker_clearance, and methane_ppm.
    """
    if methane_ppm >= settings.methane_critical_ppm:
        index, clearance = "CRITICAL", "ENTRY PROHIBITED"
    elif methane_ppm >= settings.methane_danger_ppm:
        index, clearance = "DANGER", "ENTRY PROHIBITED"
    elif methane_ppm >= settings.methane_caution_ppm:
        index, clearance = "CAUTION", "ENTRY RESTRICTED"
    else:
        index, clearance = "SAFE", "ENTRY ALLOWED"

    return {
        "node_id": node_id,
        "sewer_safety_index": index,
        "worker_clearance": clearance,
        "methane_ppm": methane_ppm,
    }


def is_hazardous(sewer_result: dict) -> bool:
    """Return True if the sewer safety index is CAUTION or worse."""
    return sewer_result.get("sewer_safety_index", "SAFE") != "SAFE"
