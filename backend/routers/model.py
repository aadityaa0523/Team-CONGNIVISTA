from fastapi import APIRouter, HTTPException

from backend.services import classifier

router = APIRouter()


@router.get("/metrics")
def model_metrics():
    """Model evaluation metrics + feature importance (Feature 33).

    Computed on a held-out split of the synthetic training data.
    """
    try:
        return classifier.evaluate()
    except Exception as exc:  # pragma: no cover - defensive
        raise HTTPException(status_code=500, detail=str(exc))
