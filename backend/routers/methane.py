from fastapi import APIRouter, Query

from backend.services import influx, sewer_safety

router = APIRouter()


@router.get("/{node_id}")
def get_methane(node_id: str, hours: int = Query(1, ge=1, le=168)):
    """Methane time-series for a node (CLAUDE2 Phase 4)."""
    df = influx.query_methane(node_id, hours=hours)
    if df.empty:
        return []
    df["time"] = df["time"].apply(lambda t: t.isoformat())
    return df.to_dict(orient="records")


@router.get("/{node_id}/sewer")
def get_sewer_safety(node_id: str):
    """Current sewer safety index + worker entry clearance for a node."""
    latest = influx.get_latest_methane(node_id)
    return sewer_safety.evaluate_sewer(node_id, latest or 0.0)
