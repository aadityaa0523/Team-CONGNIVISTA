from fastapi import APIRouter, Query

from backend.services import influx

router = APIRouter()


@router.get("/{node_id}")
def get_readings(node_id: str, hours: int = Query(6, ge=1, le=168)):
    df = influx.query_readings(node_id, hours=hours)
    if df.empty:
        return []
    df["time"] = df["time"].apply(lambda t: t.isoformat())
    return df.to_dict(orient="records")
