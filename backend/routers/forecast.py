from fastapi import APIRouter, HTTPException

from backend.services import forecaster

router = APIRouter()


@router.get("/{node_id}")
def get_forecast(node_id: str):
    """Return the 4-step (2-hour ahead) ARIMAX forecast for a node."""
    try:
        steps = forecaster.predict(node_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    return {"node_id": node_id, "forecast": steps}


@router.post("/{node_id}/train")
def trigger_train(node_id: str):
    """Manually trigger model retraining for a node (useful during demo)."""
    try:
        forecaster.train(node_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    return {"status": "trained", "node_id": node_id}
