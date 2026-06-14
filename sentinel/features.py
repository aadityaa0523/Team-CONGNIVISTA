"""HydroMind Sentinel — shared feature-engineering pipeline.

This module is the SINGLE SOURCE OF TRUTH for how raw sensor rows become model
features. Both the offline trainer (``model_validation.py``) and the online
inference engine (``hydromind_live_engine.py``) import from here, which is the
only reliable way to avoid *train/serve skew* — the bug class where the live
feature vector is computed even slightly differently from the training one and
the model silently degrades.

Nothing in here does I/O or touches the network: pure, deterministic transforms
so results are reproducible.

Feature contract
----------------
Raw input columns (from the dataset / ESP32 node):
    hour, minute, water_level, rise_rate, rainfall_1h, rainfall_3h, methane_ppm

Engineered columns:
    water_level_lag_1/2/3, rainfall_1h_lag_1, methane_lag_1            (lags)
    rolling_mean_water_level, rolling_std_water_level,
    rolling_mean_rainfall                                              (rolling)
    arimax_wl_forecast_60min                                          (Stage-1 ARIMAX)

Target:
    risk_class_60min_future  ->  SAFE=0 WATCH=1 WARNING=2 CRITICAL=3
"""
from __future__ import annotations

import numpy as np
import pandas as pd

# --------------------------------------------------------------------------- #
# Constants — defaults. model_validation may infer the real sampling cadence   #
# from the data and persist the resolved values into metadata.json; the live   #
# engine then reads them back so both sides agree exactly.                      #
# --------------------------------------------------------------------------- #
FORECAST_HORIZON_MIN = 60          # we predict risk/level this far ahead
SAMPLE_INTERVAL_MIN = 5            # assumed cadence of sensor rows (default)
HORIZON_STEPS = FORECAST_HORIZON_MIN // SAMPLE_INTERVAL_MIN  # rows ahead = 12
ROLLING_WINDOW = 6                 # rolling window length in rows (~30 min @5m)
ARIMAX_WARMUP = 60                 # min rows before the rolling ARIMAX engages
ARIMAX_ORDER = (2, 1, 2)           # ARIMAX(2,1,2) per project spec

# Class label encoding (ordinal severity).
LABEL_MAP = {"SAFE": 0, "WATCH": 1, "WARNING": 2, "CRITICAL": 3}
INV_LABEL_MAP = {v: k for k, v in LABEL_MAP.items()}
CLASS_LABELS = ["SAFE", "WATCH", "WARNING", "CRITICAL"]

# ARIMAX (Stage 1) variables.
ARIMAX_ENDOG = "water_level"
ARIMAX_EXOG = ["rainfall_1h", "rainfall_3h"]
ARIMAX_FEATURE = "arimax_wl_forecast_60min"

# Raw model-facing inputs (excludes the dropped ``overflow_margin``).
RAW_INPUT_FEATURES = [
    "hour",
    "minute",
    "water_level",
    "rise_rate",
    "rainfall_1h",
    "rainfall_3h",
    "methane_ppm",
]

LAG_FEATURES = [
    "water_level_lag_1",
    "water_level_lag_2",
    "water_level_lag_3",
    "rainfall_1h_lag_1",
    "methane_lag_1",
]

ROLLING_FEATURES = [
    "rolling_mean_water_level",
    "rolling_std_water_level",
    "rolling_mean_rainfall",
]

# Final ordered feature vector handed to the XGBoost classifier (Stage 2).
# ORDER MATTERS and is persisted to metadata — never reorder casually.
FEATURE_COLUMNS = (
    RAW_INPUT_FEATURES
    + LAG_FEATURES
    + ROLLING_FEATURES
    + [ARIMAX_FEATURE]
)

TARGET_COLUMN = "risk_class_60min_future"
DROP_COLUMNS = ["overflow_margin"]   # explicitly removed per spec


# --------------------------------------------------------------------------- #
# Timestamp parsing                                                            #
# --------------------------------------------------------------------------- #
def add_time_parts(df: pd.DataFrame, timestamp_col: str = "timestamp") -> pd.DataFrame:
    """Derive ``hour`` and ``minute`` from a timestamp column and sort by time.

    Tolerant of datasets that already carry ``hour``/``minute`` columns (in which
    case a present timestamp is still used for chronological sorting).
    """
    df = df.copy()
    if timestamp_col in df.columns:
        ts = pd.to_datetime(df[timestamp_col], errors="coerce", utc=False)
        df[timestamp_col] = ts
        df = df.sort_values(timestamp_col).reset_index(drop=True)
        # Derive from the SORTED column (not the pre-sort ``ts``) — otherwise the
        # reset index misaligns hour/minute against the reordered rows.
        if "hour" not in df.columns:
            df["hour"] = df[timestamp_col].dt.hour
        if "minute" not in df.columns:
            df["minute"] = df[timestamp_col].dt.minute
    # Guarantee the columns exist even if no timestamp was supplied.
    df["hour"] = df.get("hour", 0)
    df["minute"] = df.get("minute", 0)
    return df


def infer_sample_interval_min(df: pd.DataFrame, timestamp_col: str = "timestamp") -> float:
    """Median spacing between rows in minutes — used to resolve HORIZON_STEPS."""
    if timestamp_col not in df.columns:
        return float(SAMPLE_INTERVAL_MIN)
    ts = pd.to_datetime(df[timestamp_col], errors="coerce")
    deltas = ts.diff().dt.total_seconds().dropna() / 60.0
    deltas = deltas[deltas > 0]
    if deltas.empty:
        return float(SAMPLE_INTERVAL_MIN)
    return float(np.median(deltas))


# --------------------------------------------------------------------------- #
# Missing-value handling                                                       #
# --------------------------------------------------------------------------- #
def handle_missing(df: pd.DataFrame, columns: list[str]) -> pd.DataFrame:
    """Forward-fill then back-fill the given columns, leftover NaNs -> 0.

    Forward-fill is the physically correct default for slow-moving hydrology
    signals (a missing reading is best approximated by the previous one).
    """
    df = df.copy()
    # De-duplicate while preserving order (input lists may overlap, e.g.
    # water_level is both a raw feature and the ARIMAX endog).
    seen: set[str] = set()
    present = [c for c in columns if c in df.columns and not (c in seen or seen.add(c))]
    df[present] = df[present].ffill().bfill().fillna(0.0)
    return df


# --------------------------------------------------------------------------- #
# Lag + rolling features                                                       #
# --------------------------------------------------------------------------- #
def add_lag_features(df: pd.DataFrame) -> pd.DataFrame:
    """Append the lag features defined in LAG_FEATURES.

    Assumes ``df`` is already sorted chronologically.
    """
    df = df.copy()
    df["water_level_lag_1"] = df["water_level"].shift(1)
    df["water_level_lag_2"] = df["water_level"].shift(2)
    df["water_level_lag_3"] = df["water_level"].shift(3)
    df["rainfall_1h_lag_1"] = df["rainfall_1h"].shift(1)
    df["methane_lag_1"] = df["methane_ppm"].shift(1)
    return df


def add_rolling_features(df: pd.DataFrame, window: int = ROLLING_WINDOW) -> pd.DataFrame:
    """Append rolling mean/std features over ``window`` rows.

    ``min_periods=1`` keeps early rows usable; the std of a single point is NaN
    by definition, so it is filled with 0 (no observed variability yet).
    """
    df = df.copy()
    wl = df["water_level"].rolling(window=window, min_periods=1)
    rain = df["rainfall_1h"].rolling(window=window, min_periods=1)
    df["rolling_mean_water_level"] = wl.mean()
    df["rolling_std_water_level"] = wl.std().fillna(0.0)
    df["rolling_mean_rainfall"] = rain.mean()
    return df


def engineer_base_features(df: pd.DataFrame, window: int = ROLLING_WINDOW) -> pd.DataFrame:
    """Run the full non-ARIMAX feature pipeline (lags + rolling).

    The ARIMAX forecast column is added separately because it requires a fitted
    Stage-1 model (see ``rolling_arimax_forecast`` / ``forecast_one``).
    """
    df = add_lag_features(df)
    df = add_rolling_features(df, window=window)
    return df


# --------------------------------------------------------------------------- #
# Target encoding                                                              #
# --------------------------------------------------------------------------- #
def encode_target(series: pd.Series) -> pd.Series:
    """Map SAFE/WATCH/WARNING/CRITICAL strings to 0..3.

    Pass-through for data that is already integer-encoded.
    """
    if series.dtype == object or series.dtype == "string":
        return series.str.upper().str.strip().map(LABEL_MAP)
    return series.astype(int)


# --------------------------------------------------------------------------- #
# Stage-1 ARIMAX forecasting helpers                                           #
# --------------------------------------------------------------------------- #
# Design decision — EXOGENOUS PERSISTENCE:
# When forecasting H steps ahead we do NOT peek at future rainfall (that would
# leak information that the live node cannot have). Instead we hold the most
# recent rainfall reading constant across the horizon. The SAME assumption is
# used at training-feature generation time and at live inference time, so the
# Stage-2 classifier sees a consistent ARIMAX signal in both worlds.
def _persisted_exog(last_exog: np.ndarray, horizon: int) -> np.ndarray:
    return np.tile(np.asarray(last_exog, dtype=float).reshape(1, -1), (horizon, 1))


def forecast_one(results, last_exog: np.ndarray, horizon: int) -> float:
    """Return the ARIMAX point forecast ``horizon`` steps ahead (single value)."""
    fc = results.forecast(steps=horizon, exog=_persisted_exog(last_exog, horizon))
    return float(np.asarray(fc)[-1])


def fit_arimax(endog: np.ndarray, exog: np.ndarray, order: tuple = ARIMAX_ORDER):
    """Fit ARIMAX(order) with water_level endog and rainfall exog.

    Returns the fitted statsmodels results object. Stationarity/invertibility
    constraints are relaxed (matches backend/services/forecaster.py) so the
    optimiser does not choke on noisy real-world hydrology series.
    """
    from statsmodels.tsa.statespace.sarimax import SARIMAX

    model = SARIMAX(
        endog=np.asarray(endog, dtype=float),
        exog=np.asarray(exog, dtype=float),
        order=order,
        enforce_stationarity=False,
        enforce_invertibility=False,
    )
    return model.fit(disp=False)


def rolling_arimax_forecast(
    water: np.ndarray,
    exog: np.ndarray,
    horizon: int,
    warmup: int = ARIMAX_WARMUP,
    order: tuple = ARIMAX_ORDER,
) -> np.ndarray:
    """Generate a leak-free, per-row ``arimax_wl_forecast_60min`` column.

    Walk-forward strategy:
      1. Fit ARIMAX once on the warm-up window ``water[:warmup]``.
      2. Step through the series; at row ``i`` (having observed 0..i) forecast
         ``horizon`` steps with persisted exog and record the H-th value as the
         model's estimate of ``water_level[i + horizon]``.
      3. Incorporate the freshly observed point via ``results.extend`` (reuses
         the trained parameters, no re-estimation — fast and avoids look-ahead).

    Rows before the warm-up are left as NaN (dropped downstream). No future
    target information ever enters the feature.
    """
    water = np.asarray(water, dtype=float)
    exog = np.asarray(exog, dtype=float)
    n = len(water)
    out = np.full(n, np.nan)

    if n <= warmup + horizon:
        return out  # not enough history to bother

    results = fit_arimax(water[:warmup], exog[:warmup], order=order)

    i = warmup - 1  # model currently "knows" rows 0..warmup-1
    while i < n:
        out[i] = forecast_one(results, exog[i], horizon)
        nxt = i + 1
        if nxt >= n:
            break
        # Extend the filter with the genuinely-observed next row.
        results = results.extend(
            endog=water[nxt:nxt + 1],
            exog=exog[nxt:nxt + 1],
        )
        i = nxt
    return out


def live_arimax_forecast(
    arimax_results,
    history: pd.DataFrame,
    horizon: int,
    warmup: int = ARIMAX_WARMUP,
) -> tuple[float, str]:
    """Forecast water level ``horizon`` steps ahead from a live history buffer.

    Reuses the TRAINED ARIMAX parameters via ``results.apply`` (re-anchors the
    state-space model onto the live window without re-estimating coefficients),
    then forecasts with persisted exog. Degrades gracefully:

      * < warmup rows of history          -> linear-trend / persistence fallback
      * any statsmodels failure            -> persistence fallback

    Returns ``(predicted_water_level, method_used)``.
    """
    wl = history["water_level"].to_numpy(dtype=float)
    last_wl = float(wl[-1]) if len(wl) else 0.0

    if arimax_results is None or len(history) < max(warmup, horizon + 5):
        # Cheap fallback: extrapolate the recent linear trend, clamped.
        if len(wl) >= 2:
            slope = float(wl[-1] - wl[-min(len(wl), horizon + 1)]) / max(1, min(len(wl) - 1, horizon))
            pred = float(np.clip(last_wl + slope * horizon, last_wl - 100.0, last_wl + 100.0))
            return pred, "trend_fallback"
        return last_wl, "persistence_fallback"

    try:
        exog = history[ARIMAX_EXOG].to_numpy(dtype=float)
        applied = arimax_results.apply(endog=wl, exog=exog)
        pred = forecast_one(applied, exog[-1], horizon)
        # Clamp to a physically plausible band relative to the last reading.
        pred = float(np.clip(pred, last_wl - 100.0, last_wl + 100.0))
        return pred, "arimax"
    except Exception:
        return last_wl, "persistence_fallback"
