"""HydroMind Sentinel — File 1: ARIMAX + XGBoost ensemble trainer & evaluator.

Reproducible pipeline that:
  1. Loads the drainage dataset (CSV) — or generates a domain-driven synthetic
     dataset when no CSV is supplied, so the pipeline runs end-to-end today.
  2. Preprocesses: timestamp -> hour/minute, chronological sort, drop
     ``overflow_margin``, impute missing values, build lag + rolling features,
     encode the target.
  3. Stage 1 — fits an ARIMAX(2,1,2) water-level forecaster and produces a
     leak-free ``arimax_wl_forecast_60min`` feature (rolling walk-forward).
  4. Stage 2 — trains an XGBoost multi-class classifier on the full feature set.
  5. Splits 70 / 15 / 15 chronologically (NO shuffling) and reports
     TimeSeriesSplit cross-validation on the train portion.
  6. Evaluates on the held-out test set: accuracy, precision, recall, F1,
     confusion matrix and feature importance.
  7. Persists every artifact (ARIMAX model, XGBoost model, metadata, metrics,
     plots) into ``models/sentinel/`` for the live engine to consume.

Usage
-----
    python sentinel/model_validation.py                 # synthetic demo data
    python sentinel/model_validation.py --csv data.csv  # your real dataset
    python sentinel/model_validation.py --rows 4000 --seed 7
"""
from __future__ import annotations

import argparse
import json
import os
import pickle
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd

# Make ``import features`` work regardless of the caller's CWD.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import features as F  # noqa: E402

# Global determinism for a reproducible training run.
RANDOM_SEED = 42

_PROJECT_ROOT = Path(__file__).resolve().parents[1]
_ARTIFACT_DIR = _PROJECT_ROOT / "models" / "sentinel"
_ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)


# --------------------------------------------------------------------------- #
# 0. Synthetic dataset (used only when no CSV is provided)                     #
# --------------------------------------------------------------------------- #
def generate_synthetic_dataset(n_rows: int = 3000, seed: int = RANDOM_SEED) -> pd.DataFrame:
    """Create a physically-plausible urban-drainage time series.

    The series is autoregressive in water level, driven by bursty rainfall, with
    methane accumulating during stagnation. The risk label is derived from the
    FUTURE state (``HORIZON_STEPS`` rows ahead) so the learning task genuinely is
    "predict risk 60 minutes from now". Includes the ``overflow_margin`` column
    purely so we can demonstrate dropping it.
    """
    rng = np.random.default_rng(seed)
    start = datetime(2025, 6, 1, 0, 0, 0)
    timestamps = [start + timedelta(minutes=F.SAMPLE_INTERVAL_MIN * i) for i in range(n_rows)]

    # Bursty rainfall: mostly dry with occasional storms.
    rainfall_1h = np.zeros(n_rows)
    storm = 0.0
    for i in range(n_rows):
        if rng.random() < 0.02:            # ~2% chance to (re)ignite a storm
            storm = rng.uniform(5, 40)
        storm *= 0.85                       # storms decay
        rainfall_1h[i] = max(0.0, storm + rng.normal(0, 0.5))
    # 3-hour rainfall ≈ trailing sum of the hourly proxy.
    rainfall_3h = pd.Series(rainfall_1h).rolling(36, min_periods=1).sum().to_numpy()

    # Water level: AR(1) base + rainfall response + diurnal term.
    water = np.zeros(n_rows)
    water[0] = 40.0
    for i in range(1, n_rows):
        diurnal = 4.0 * np.sin(2 * np.pi * (timestamps[i].hour / 24.0))
        water[i] = (
            0.92 * water[i - 1]
            + 0.08 * 40.0
            + 0.6 * rainfall_1h[i]
            + 0.15 * diurnal
            + rng.normal(0, 1.2)
        )
    water = np.clip(water, 5, 130)

    rise_rate = np.diff(water, prepend=water[0]) / F.SAMPLE_INTERVAL_MIN

    # Methane accumulates when water is stagnant/high, vents when flowing.
    methane = np.zeros(n_rows)
    methane[0] = 120.0
    for i in range(1, n_rows):
        accumulate = 30.0 if (rise_rate[i] < 0.2 and water[i] > 50) else -10.0
        methane[i] = max(0.0, 0.95 * methane[i - 1] + accumulate + rng.normal(0, 8))
    methane = np.clip(methane, 0, 1600)

    overflow_margin = np.clip(120 - water, 0, None)  # to be dropped

    df = pd.DataFrame({
        "timestamp": timestamps,
        "water_level": water,
        "rise_rate": rise_rate,
        "rainfall_1h": rainfall_1h,
        "rainfall_3h": rainfall_3h,
        "methane_ppm": methane,
        "overflow_margin": overflow_margin,
    })

    # Instantaneous risk from current conditions, then shifted into the future.
    inst = _instantaneous_risk(df, rng)
    future = pd.Series(inst).shift(-F.HORIZON_STEPS)
    df[F.TARGET_COLUMN] = future.map(F.INV_LABEL_MAP)
    return df


def _instantaneous_risk(df: pd.DataFrame, rng) -> np.ndarray:
    """Domain rule mapping conditions -> 0..3 with light label noise."""
    wl = df["water_level"].to_numpy()
    rise = df["rise_rate"].to_numpy()
    ch4 = df["methane_ppm"].to_numpy()

    risk = np.where(
        (wl >= 95) | (ch4 >= 1000), 3,
        np.where(wl >= 78, 2, np.where(wl >= 60, 1, 0)),
    )
    risk = np.where((risk == 1) & (rise > 2.5), 2, risk)   # rapid-rise escalation
    risk = np.where((risk == 2) & (rise > 4.0), 3, risk)
    noise = rng.random(len(risk)) < 0.06                    # 6% label noise
    risk[noise] = rng.integers(0, 4, noise.sum())
    return risk.astype(int)


# --------------------------------------------------------------------------- #
# 1. Load + preprocess                                                         #
# --------------------------------------------------------------------------- #
def load_dataset(csv_path: str | None, rows: int, seed: int) -> pd.DataFrame:
    if csv_path:
        print(f"[data] Loading dataset from {csv_path}")
        df = pd.read_csv(csv_path)
    else:
        print(f"[data] No --csv supplied; generating {rows} synthetic rows")
        df = generate_synthetic_dataset(rows, seed)
    return df


def preprocess(df: pd.DataFrame) -> tuple[pd.DataFrame, int, float]:
    """Full preprocessing -> model-ready frame. Returns (df, horizon, interval)."""
    # Drop excluded columns.
    df = df.drop(columns=[c for c in F.DROP_COLUMNS if c in df.columns], errors="ignore")

    # Timestamp -> hour/minute + chronological sort.
    interval = F.infer_sample_interval_min(df)
    horizon = max(1, round(F.FORECAST_HORIZON_MIN / interval))
    df = F.add_time_parts(df)
    print(f"[data] Sample interval ~ {interval:.1f} min  ->  horizon = {horizon} rows")

    # Missing values on every raw signal.
    df = F.handle_missing(df, F.RAW_INPUT_FEATURES + F.ARIMAX_EXOG + [F.ARIMAX_ENDOG])

    # Lag + rolling features.
    df = F.engineer_base_features(df)

    # Stage-1 ARIMAX feature (leak-free walk-forward).
    print("[stage1] Generating rolling ARIMAX(2,1,2) water-level forecast feature...")
    df[F.ARIMAX_FEATURE] = F.rolling_arimax_forecast(
        water=df[F.ARIMAX_ENDOG].to_numpy(),
        exog=df[F.ARIMAX_EXOG].to_numpy(),
        horizon=horizon,
    )

    # Encode target.
    df[F.TARGET_COLUMN] = F.encode_target(df[F.TARGET_COLUMN])

    # Drop rows made unusable by lags / rolling warm-up / ARIMAX warm-up /
    # the forward-shifted target.
    needed = F.FEATURE_COLUMNS + [F.TARGET_COLUMN]
    before = len(df)
    df = df.dropna(subset=needed).reset_index(drop=True)
    df[F.TARGET_COLUMN] = df[F.TARGET_COLUMN].astype(int)
    print(f"[data] Usable rows after feature warm-up: {len(df)} (dropped {before - len(df)})")
    return df, horizon, interval


# --------------------------------------------------------------------------- #
# 2. Chronological split                                                       #
# --------------------------------------------------------------------------- #
def chronological_split(df: pd.DataFrame):
    """70 / 15 / 15 split preserving time order (no shuffling)."""
    n = len(df)
    i_train = int(n * 0.70)
    i_val = int(n * 0.85)
    train, val, test = df.iloc[:i_train], df.iloc[i_train:i_val], df.iloc[i_val:]
    print(f"[split] train={len(train)}  val={len(val)}  test={len(test)} (chronological)")
    return train, val, test


def _xy(df: pd.DataFrame):
    return df[F.FEATURE_COLUMNS].to_numpy(dtype=float), df[F.TARGET_COLUMN].to_numpy(dtype=int)


# --------------------------------------------------------------------------- #
# 3. Cross-validation (TimeSeriesSplit) + final training                       #
# --------------------------------------------------------------------------- #
def _make_classifier():
    from xgboost import XGBClassifier

    return XGBClassifier(
        objective="multi:softprob",
        num_class=len(F.CLASS_LABELS),
        n_estimators=400,
        max_depth=5,
        learning_rate=0.05,
        subsample=0.9,
        colsample_bytree=0.9,
        reg_lambda=1.0,
        random_state=RANDOM_SEED,
        n_jobs=-1,
        eval_metric="mlogloss",
        tree_method="hist",
    )


def cross_validate(train: pd.DataFrame, n_splits: int = 5) -> list[float]:
    """TimeSeriesSplit CV on the training portion (forward-chaining, no shuffle)."""
    from sklearn.metrics import accuracy_score
    from sklearn.model_selection import TimeSeriesSplit

    X, y = _xy(train)
    tscv = TimeSeriesSplit(n_splits=n_splits)
    accs: list[float] = []
    for k, (tr_idx, va_idx) in enumerate(tscv.split(X), start=1):
        clf = _make_classifier()
        clf.fit(X[tr_idx], y[tr_idx], verbose=False)
        acc = accuracy_score(y[va_idx], clf.predict(X[va_idx]))
        accs.append(acc)
        print(f"[cv] fold {k}/{n_splits}  acc={acc:.4f}  "
              f"(train={len(tr_idx)}, val={len(va_idx)})")
    print(f"[cv] mean acc = {np.mean(accs):.4f} +/- {np.std(accs):.4f}")
    return accs


def train_final(train: pd.DataFrame, val: pd.DataFrame):
    """Train the production classifier with early stopping on the val split.

    Class imbalance (SAFE dominates) is countered with balanced sample weights.
    """
    from sklearn.utils.class_weight import compute_sample_weight

    X_tr, y_tr = _xy(train)
    X_va, y_va = _xy(val)
    sample_weight = compute_sample_weight(class_weight="balanced", y=y_tr)

    clf = _make_classifier()
    # early_stopping_rounds keyword moved across xgboost versions; try the
    # modern constructor arg first, fall back to a plain fit.
    try:
        clf.set_params(early_stopping_rounds=30)
        clf.fit(X_tr, y_tr, sample_weight=sample_weight,
                eval_set=[(X_va, y_va)], verbose=False)
    except TypeError:
        clf.fit(X_tr, y_tr, sample_weight=sample_weight, verbose=False)
    print("[stage2] XGBoost classifier trained.")
    return clf


# --------------------------------------------------------------------------- #
# 4. Evaluation                                                                #
# --------------------------------------------------------------------------- #
def evaluate(clf, test: pd.DataFrame) -> dict:
    """Compute accuracy, precision, recall, F1, confusion matrix, importances."""
    from sklearn.metrics import (
        accuracy_score,
        classification_report,
        confusion_matrix,
        f1_score,
        precision_score,
        recall_score,
    )

    X_te, y_te = _xy(test)
    y_pred = clf.predict(X_te)
    labels = list(range(len(F.CLASS_LABELS)))

    metrics = {
        "accuracy": float(accuracy_score(y_te, y_pred)),
        "precision_macro": float(precision_score(y_te, y_pred, average="macro", zero_division=0)),
        "recall_macro": float(recall_score(y_te, y_pred, average="macro", zero_division=0)),
        "f1_macro": float(f1_score(y_te, y_pred, average="macro", zero_division=0)),
        "precision_weighted": float(precision_score(y_te, y_pred, average="weighted", zero_division=0)),
        "recall_weighted": float(recall_score(y_te, y_pred, average="weighted", zero_division=0)),
        "f1_weighted": float(f1_score(y_te, y_pred, average="weighted", zero_division=0)),
    }
    cm = confusion_matrix(y_te, y_pred, labels=labels)
    report = classification_report(
        y_te, y_pred, labels=labels, target_names=F.CLASS_LABELS, zero_division=0
    )
    importances = dict(zip(F.FEATURE_COLUMNS, [float(v) for v in clf.feature_importances_]))

    # --- console summary ---
    print("\n================ TEST-SET EVALUATION ================")
    print(f"Accuracy           : {metrics['accuracy']:.4f}")
    print(f"Precision (macro)  : {metrics['precision_macro']:.4f}")
    print(f"Recall    (macro)  : {metrics['recall_macro']:.4f}")
    print(f"F1        (macro)  : {metrics['f1_macro']:.4f}")
    print("\nPer-class report:\n" + report)
    print("Confusion matrix (rows=true, cols=pred):")
    print("            " + "  ".join(f"{c[:5]:>6}" for c in F.CLASS_LABELS))
    for i, row in enumerate(cm):
        print(f"  {F.CLASS_LABELS[i]:>9} " + "  ".join(f"{v:>6}" for v in row))
    print("\nFeature importance (descending):")
    for name, imp in sorted(importances.items(), key=lambda kv: kv[1], reverse=True):
        print(f"  {name:<28} {imp:.4f}")
    print("=====================================================\n")

    metrics["confusion_matrix"] = cm.tolist()
    metrics["classification_report"] = report
    metrics["feature_importance"] = importances
    _save_plots(cm, importances)
    return metrics


def _save_plots(cm: np.ndarray, importances: dict) -> None:
    """Save confusion-matrix + feature-importance PNGs (best-effort)."""
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except Exception as exc:  # matplotlib optional
        print(f"[plot] matplotlib unavailable, skipping plots ({exc})")
        return

    # Confusion matrix
    fig, ax = plt.subplots(figsize=(5, 4))
    im = ax.imshow(cm, cmap="Blues")
    ax.set_xticks(range(len(F.CLASS_LABELS)), F.CLASS_LABELS, rotation=45, ha="right")
    ax.set_yticks(range(len(F.CLASS_LABELS)), F.CLASS_LABELS)
    ax.set_xlabel("Predicted"); ax.set_ylabel("True")
    ax.set_title("Confusion Matrix")
    for i in range(cm.shape[0]):
        for j in range(cm.shape[1]):
            ax.text(j, i, str(cm[i, j]), ha="center", va="center",
                    color="white" if cm[i, j] > cm.max() / 2 else "black")
    fig.colorbar(im); fig.tight_layout()
    fig.savefig(_ARTIFACT_DIR / "confusion_matrix.png", dpi=120)
    plt.close(fig)

    # Feature importance
    items = sorted(importances.items(), key=lambda kv: kv[1])
    fig, ax = plt.subplots(figsize=(7, 5))
    ax.barh([k for k, _ in items], [v for _, v in items], color="#2a7ab9")
    ax.set_title("XGBoost Feature Importance"); fig.tight_layout()
    fig.savefig(_ARTIFACT_DIR / "feature_importance.png", dpi=120)
    plt.close(fig)
    print(f"[plot] Saved confusion_matrix.png + feature_importance.png to {_ARTIFACT_DIR}")


# --------------------------------------------------------------------------- #
# 5. Persistence                                                              #
# --------------------------------------------------------------------------- #
def persist(clf, arimax_results, df: pd.DataFrame, horizon: int,
            interval: float, metrics: dict, cv_accs: list[float]) -> None:
    """Save all artifacts the live engine needs into models/sentinel/."""
    # XGBoost classifier (native JSON format = version-portable).
    clf.save_model(str(_ARTIFACT_DIR / "xgb_classifier.json"))

    # ARIMAX results trained on the train portion (live engine re-applies params).
    with open(_ARTIFACT_DIR / "arimax.pkl", "wb") as fh:
        pickle.dump(arimax_results, fh)

    # Per-feature medians for live imputation of any missing/cold-start value.
    medians = {c: float(df[c].median()) for c in F.FEATURE_COLUMNS}

    metadata = {
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "feature_columns": F.FEATURE_COLUMNS,
        "label_map": F.LABEL_MAP,
        "class_labels": F.CLASS_LABELS,
        "horizon_steps": horizon,
        "sample_interval_min": interval,
        "forecast_horizon_min": F.FORECAST_HORIZON_MIN,
        "rolling_window": F.ROLLING_WINDOW,
        "arimax_order": list(F.ARIMAX_ORDER),
        "arimax_warmup": F.ARIMAX_WARMUP,
        "arimax_endog": F.ARIMAX_ENDOG,
        "arimax_exog": F.ARIMAX_EXOG,
        "feature_medians": medians,
        "random_seed": RANDOM_SEED,
    }
    with open(_ARTIFACT_DIR / "metadata.json", "w", encoding="utf-8") as fh:
        json.dump(metadata, fh, indent=2)

    metrics_out = dict(metrics)
    metrics_out["cv_accuracies"] = [float(a) for a in cv_accs]
    metrics_out["cv_mean_accuracy"] = float(np.mean(cv_accs)) if cv_accs else None
    with open(_ARTIFACT_DIR / "metrics.json", "w", encoding="utf-8") as fh:
        json.dump(metrics_out, fh, indent=2)

    print(f"[save] Artifacts written to {_ARTIFACT_DIR}")
    print("       - xgb_classifier.json  - arimax.pkl  - metadata.json  - metrics.json")


# --------------------------------------------------------------------------- #
# Orchestration                                                               #
# --------------------------------------------------------------------------- #
def main() -> None:
    parser = argparse.ArgumentParser(description="HydroMind Sentinel trainer")
    parser.add_argument("--csv", default=None, help="Path to drainage dataset CSV")
    parser.add_argument("--rows", type=int, default=3000, help="Synthetic rows if no CSV")
    parser.add_argument("--seed", type=int, default=RANDOM_SEED)
    parser.add_argument("--cv-splits", type=int, default=5)
    args = parser.parse_args()

    np.random.seed(args.seed)

    print("===== HydroMind Sentinel - ARIMAX + XGBoost ensemble =====")
    raw = load_dataset(args.csv, args.rows, args.seed)
    df, horizon, interval = preprocess(raw)

    train, val, test = chronological_split(df)

    print("\n----- TimeSeriesSplit cross-validation (train portion) -----")
    cv_accs = cross_validate(train, n_splits=args.cv_splits)

    print("\n----- Final training -----")
    clf = train_final(train, val)

    metrics = evaluate(clf, test)

    # Refit a clean Stage-1 ARIMAX on the train water series for the live engine.
    print("[stage1] Fitting deployable ARIMAX on train portion...")
    arimax_results = F.fit_arimax(
        endog=train[F.ARIMAX_ENDOG].to_numpy(),
        exog=train[F.ARIMAX_EXOG].to_numpy(),
    )

    persist(clf, arimax_results, df, horizon, interval, metrics, cv_accs)
    print("Done. Run hydromind_live_engine.py to serve live predictions.")


if __name__ == "__main__":
    main()
