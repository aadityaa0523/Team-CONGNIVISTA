"""ML classifiers for flood risk, time-to-flood, recovery, and anomaly detection.

Models are trained on synthetic data derived from domain rules and stored in models/.
They lazy-train on first prediction if no pickle exists.
Features: [water_level_cm, fill_pct, rise_rate_cm_per_min, methane_ppm, rainfall_mm, hour_of_day]
"""
import logging
import pickle
from pathlib import Path

import numpy as np
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor

logger = logging.getLogger(__name__)

_MODELS_DIR = Path(__file__).resolve().parents[2] / "models"
_MODELS_DIR.mkdir(exist_ok=True)

_RISK_MODEL_PATH = _MODELS_DIR / "flood_risk_classifier.pkl"
_TTF_MODEL_PATH = _MODELS_DIR / "ttf_regressor.pkl"

CLASS_LABELS = ["SAFE", "WATCH", "WARNING", "CRITICAL"]

_FEATURE_ORDER = [
    "water_level_cm",
    "fill_pct",
    "rise_rate_cm_per_min",
    "methane_ppm",
    "rainfall_mm",
    "hour_of_day",
]


def _generate_synthetic_data(n: int = 3000):
    """Produce labelled training data based on flood domain rules + noise."""
    rng = np.random.default_rng(42)

    water_level = rng.uniform(10, 100, n)
    fill_pct = np.clip(water_level + rng.normal(0, 5, n), 0, 100)
    rise_rate = np.abs(rng.normal(0, 1.5, n))
    methane_ppm = rng.exponential(80, n)
    rainfall_mm = rng.exponential(4, n)
    hour_of_day = rng.integers(0, 24, n).astype(float)

    X = np.column_stack([water_level, fill_pct, rise_rate, methane_ppm, rainfall_mm, hour_of_day])

    # Flood risk classification: driven primarily by fill_pct + rise_rate
    risk = np.where(
        fill_pct >= 85,
        3,  # CRITICAL
        np.where(
            fill_pct >= 75,
            2,  # WARNING
            np.where(fill_pct >= 60, 1, 0),  # WATCH / SAFE
        ),
    )
    # Escalate some WATCH→WARNING when rise_rate is very high
    risk = np.where((risk == 1) & (rise_rate > 3), 2, risk)
    # Random 8% noise so the model generalises instead of memorising rules
    noise_mask = rng.random(n) < 0.08
    risk[noise_mask] = rng.integers(0, 4, noise_mask.sum())

    # TTF (minutes to overflow): inversely proportional to fill_pct and rise_rate
    headroom = np.maximum(0, 100 - fill_pct)
    ttf = np.where(rise_rate > 0.05, headroom / (rise_rate + 0.1) * 2, 240.0)
    ttf = np.clip(ttf, 0, 240)

    return X, risk.astype(int), ttf


def train_classifiers() -> None:
    """Train and pickle both classifiers from synthetic data."""
    X, y_risk, y_ttf = _generate_synthetic_data()

    clf = RandomForestClassifier(n_estimators=100, random_state=42, n_jobs=-1)
    clf.fit(X, y_risk)
    with open(_RISK_MODEL_PATH, "wb") as f:
        pickle.dump(clf, f)

    reg = RandomForestRegressor(n_estimators=100, random_state=42, n_jobs=-1)
    reg.fit(X, y_ttf)
    with open(_TTF_MODEL_PATH, "wb") as f:
        pickle.dump(reg, f)

    logger.info("ML classifiers trained and saved to models/")


def _features_to_array(features: dict) -> np.ndarray:
    return np.array([[features.get(k, 0.0) for k in _FEATURE_ORDER]])


def _load(path: Path, train_fn):
    if not path.exists():
        logger.info("Model not found at %s — training now", path)
        train_fn()
    with open(path, "rb") as f:
        return pickle.load(f)


def predict_flood_risk(features: dict) -> dict:
    """Return {"class": "WARNING", "probability": 0.82}."""
    clf = _load(_RISK_MODEL_PATH, train_classifiers)
    X = _features_to_array(features)
    pred = int(clf.predict(X)[0])
    proba = float(clf.predict_proba(X)[0][pred])
    return {"class": CLASS_LABELS[pred], "probability": round(proba, 3)}


def predict_ttf(features: dict) -> float:
    """Return estimated minutes until overflow (capped at 240)."""
    reg = _load(_TTF_MODEL_PATH, train_classifiers)
    X = _features_to_array(features)
    return round(float(np.clip(reg.predict(X)[0], 0, 240)), 1)


def predict_recovery(features: dict) -> float:
    """Estimate minutes until recovery. Heuristic: 1.5 × fill_pct."""
    fill_pct = features.get("fill_pct", 50.0)
    return round(max(0.0, fill_pct * 1.5), 1)


def evaluate() -> dict:
    """Train/test split the synthetic data and report classification metrics
    plus feature importances. Powers the Model Evaluation Dashboard (Feature 33).
    """
    from sklearn.metrics import (
        accuracy_score,
        f1_score,
        precision_score,
        recall_score,
        confusion_matrix,
    )
    from sklearn.model_selection import train_test_split

    X, y_risk, y_ttf = _generate_synthetic_data()
    X_tr, X_te, y_tr, y_te = train_test_split(
        X, y_risk, test_size=0.25, random_state=7, stratify=y_risk
    )

    clf = RandomForestClassifier(n_estimators=100, random_state=42, n_jobs=-1)
    clf.fit(X_tr, y_tr)
    y_pred = clf.predict(X_te)

    # TTF regressor RMSE on the same split.
    reg = RandomForestRegressor(n_estimators=100, random_state=42, n_jobs=-1)
    _, _, ttf_tr, ttf_te = train_test_split(
        X, y_ttf, test_size=0.25, random_state=7, stratify=y_risk
    )
    reg.fit(X_tr, ttf_tr)
    ttf_pred = reg.predict(X_te)
    rmse = float(np.sqrt(np.mean((ttf_pred - ttf_te) ** 2)))

    return {
        "classifier": {
            "accuracy": round(float(accuracy_score(y_te, y_pred)), 3),
            "precision": round(float(precision_score(y_te, y_pred, average="macro", zero_division=0)), 3),
            "recall": round(float(recall_score(y_te, y_pred, average="macro", zero_division=0)), 3),
            "f1": round(float(f1_score(y_te, y_pred, average="macro", zero_division=0)), 3),
            "labels": CLASS_LABELS,
            "confusion_matrix": confusion_matrix(y_te, y_pred, labels=[0, 1, 2, 3]).tolist(),
        },
        "ttf_regressor": {"rmse_min": round(rmse, 1)},
        "feature_importance": [
            {"feature": f, "importance": round(float(imp), 3)}
            for f, imp in sorted(
                zip(_FEATURE_ORDER, clf.feature_importances_),
                key=lambda p: p[1],
                reverse=True,
            )
        ],
        "n_train": int(len(X_tr)),
        "n_test": int(len(X_te)),
    }


def detect_anomaly(features: dict) -> tuple[bool, str]:
    """Rule-based anomaly detection for unusual drainage behaviour."""
    rise_rate = features.get("rise_rate_cm_per_min", 0.0)
    methane = features.get("methane_ppm", 0.0)
    fill_pct = features.get("fill_pct", 0.0)
    rainfall = features.get("rainfall_mm", 0.0)

    if rise_rate > 5:
        return True, "Rapid water rise detected"
    if methane > 800:
        return True, "Sudden methane spike"
    if fill_pct > 85 and rainfall < 0.5 and rise_rate < 0.1:
        return True, "High water level without rainfall — possible backflow or blockage"
    return False, ""
