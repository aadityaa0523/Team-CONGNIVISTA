"""Tests for the HydroMind Sentinel ML pipeline (sentinel/ trio).

Covers:
  * features.py        — the shared, deterministic feature-engineering pipeline
  * model_validation   — synthetic dataset generation + chronological split
  * hydromind_live_engine — end-to-end inference against the trained artifacts

Assertion style: structural validity (valid class labels, probabilities in
[0, 1], correct shapes) PLUS the deterministic domain rules. Model-output values
that depend on training noise are checked structurally, not pinned, so the suite
stays robust.
"""
import sys
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

# The sentinel modules are a standalone (non-package) trio that import each other
# by bare name, so put their directory on sys.path before importing.
_SENTINEL_DIR = Path(__file__).resolve().parents[1] / "sentinel"
if str(_SENTINEL_DIR) not in sys.path:
    sys.path.insert(0, str(_SENTINEL_DIR))

import features as F  # noqa: E402
import model_validation as MV  # noqa: E402

_ARTIFACT_DIR = Path(__file__).resolve().parents[1] / "models" / "sentinel"


# ── features.py — time parts ─────────────────────────────────────────────────
class TestTimeParts:
    def test_derives_hour_minute_and_sorts(self):
        df = pd.DataFrame({
            "timestamp": ["2025-06-01 02:30:00", "2025-06-01 01:15:00"],
            "water_level": [50.0, 40.0],
        })
        out = F.add_time_parts(df)
        # Sorted chronologically -> the 01:15 row comes first.
        assert out["water_level"].tolist() == [40.0, 50.0]
        assert out["hour"].tolist() == [1, 2]
        assert out["minute"].tolist() == [15, 30]

    def test_columns_guaranteed_without_timestamp(self):
        df = pd.DataFrame({"water_level": [10.0, 20.0]})
        out = F.add_time_parts(df)
        assert "hour" in out.columns and "minute" in out.columns


# ── features.py — missing values ─────────────────────────────────────────────
class TestHandleMissing:
    def test_ffill_then_bfill_then_zero(self):
        df = pd.DataFrame({"water_level": [np.nan, 5.0, np.nan, np.nan]})
        out = F.handle_missing(df, ["water_level"])
        # leading NaN back-filled to 5, trailing forward-filled from 5.
        assert out["water_level"].tolist() == [5.0, 5.0, 5.0, 5.0]
        assert not out["water_level"].isna().any()

    def test_all_nan_column_becomes_zero(self):
        df = pd.DataFrame({"rainfall_1h": [np.nan, np.nan]})
        out = F.handle_missing(df, ["rainfall_1h"])
        assert out["rainfall_1h"].tolist() == [0.0, 0.0]


# ── features.py — lag + rolling ──────────────────────────────────────────────
class TestLagRolling:
    def _frame(self):
        return pd.DataFrame({
            "water_level": [10.0, 20.0, 30.0, 40.0],
            "rainfall_1h": [0.0, 2.0, 4.0, 6.0],
            "methane_ppm": [100.0, 110.0, 120.0, 130.0],
        })

    def test_lag_features_are_shifts(self):
        out = F.add_lag_features(self._frame())
        assert np.isnan(out["water_level_lag_1"].iloc[0])
        assert out["water_level_lag_1"].tolist()[1:] == [10.0, 20.0, 30.0]
        assert out["water_level_lag_3"].tolist()[3] == 10.0
        assert out["methane_lag_1"].tolist()[1:] == [100.0, 110.0, 120.0]

    def test_rolling_mean_and_std(self):
        out = F.add_rolling_features(self._frame(), window=2)
        # First row: rolling mean of a single point == the point itself.
        assert out["rolling_mean_water_level"].iloc[0] == 10.0
        # std of a single point is NaN by definition -> filled with 0.
        assert out["rolling_std_water_level"].iloc[0] == 0.0
        # Window=2 mean of rows 0,1 = 15.
        assert out["rolling_mean_water_level"].iloc[1] == 15.0

    def test_no_nans_in_rolling_std(self):
        out = F.add_rolling_features(self._frame(), window=3)
        assert not out["rolling_std_water_level"].isna().any()


# ── features.py — target encoding ────────────────────────────────────────────
class TestEncodeTarget:
    def test_string_labels_mapped(self):
        s = pd.Series(["SAFE", "watch", " WARNING ", "CRITICAL"])
        assert F.encode_target(s).tolist() == [0, 1, 2, 3]

    def test_integer_passthrough(self):
        s = pd.Series([0, 1, 2, 3])
        assert F.encode_target(s).tolist() == [0, 1, 2, 3]


# ── features.py — ARIMAX helpers ─────────────────────────────────────────────
class TestArimaxFeature:
    def test_persisted_exog_shape_and_values(self):
        out = F._persisted_exog(np.array([3.0, 7.0]), horizon=4)
        assert out.shape == (4, 2)
        # Same exog persisted across the whole horizon (no future leakage).
        assert np.all(out == np.array([3.0, 7.0]))

    def test_rolling_forecast_returns_nan_when_too_short(self):
        water = np.arange(20, dtype=float)
        exog = np.zeros((20, 2))
        out = F.rolling_arimax_forecast(water, exog, horizon=3, warmup=18)
        assert out.shape == (20,)
        assert np.isnan(out).all()

    def test_rolling_forecast_is_leak_free_and_shaped(self):
        rng = np.random.default_rng(0)
        n, warmup, horizon = 60, 20, 3
        t = np.arange(n)
        water = 40 + 5 * np.sin(t / 4.0) + rng.normal(0, 0.5, n)
        exog = np.column_stack([rng.random(n), rng.random(n)])

        out = F.rolling_arimax_forecast(water, exog, horizon=horizon, warmup=warmup)

        assert out.shape == (n,)
        # Warm-up region carries no forecast (no look-ahead into the target).
        assert np.isnan(out[: warmup - 1]).all()
        # Everything from the warm-up boundary onward is a finite forecast.
        assert np.isfinite(out[warmup - 1:]).all()


# ── features.py — feature contract ───────────────────────────────────────────
class TestFeatureContract:
    def test_feature_columns_composition(self):
        expected_len = (
            len(F.RAW_INPUT_FEATURES)
            + len(F.LAG_FEATURES)
            + len(F.ROLLING_FEATURES)
            + 1  # ARIMAX feature
        )
        assert len(F.FEATURE_COLUMNS) == expected_len
        # No duplicate feature names.
        assert len(set(F.FEATURE_COLUMNS)) == len(F.FEATURE_COLUMNS)
        # ARIMAX forecast is the final column (order is persisted to metadata).
        assert F.FEATURE_COLUMNS[-1] == F.ARIMAX_FEATURE
        assert "overflow_margin" not in F.FEATURE_COLUMNS  # explicitly dropped


# ── model_validation — synthetic data + split ────────────────────────────────
class TestSyntheticDataset:
    def test_has_expected_columns_and_rows(self):
        df = MV.generate_synthetic_dataset(n_rows=200, seed=1)
        assert len(df) == 200
        for col in ("timestamp", "water_level", "rainfall_1h", "methane_ppm",
                    "overflow_margin", F.TARGET_COLUMN):
            assert col in df.columns

    def test_labels_are_valid_classes(self):
        df = MV.generate_synthetic_dataset(n_rows=200, seed=1)
        labels = set(df[F.TARGET_COLUMN].dropna().unique())
        assert labels.issubset(set(F.CLASS_LABELS))

    def test_water_level_within_physical_bounds(self):
        df = MV.generate_synthetic_dataset(n_rows=300, seed=2)
        assert df["water_level"].between(5, 130).all()


class TestChronologicalSplit:
    def test_split_ratios_and_order(self):
        df = pd.DataFrame({"x": range(100)})
        train, val, test = MV.chronological_split(df)
        assert (len(train), len(val), len(test)) == (70, 15, 15)
        # No shuffling: the concatenation must reproduce the original order.
        joined = pd.concat([train, val, test])["x"].tolist()
        assert joined == list(range(100))


# ── hydromind_live_engine — end-to-end inference ─────────────────────────────
@pytest.mark.skipif(
    not (_ARTIFACT_DIR / "metadata.json").exists(),
    reason="Sentinel artifacts not trained (run sentinel/model_validation.py)",
)
class TestLiveEngine:
    @pytest.fixture(scope="class")
    def engine(self):
        pytest.importorskip("xgboost")
        from hydromind_live_engine import HydroMindSentinel
        return HydroMindSentinel()

    # A rising flood scenario: water + methane climb together.
    _SCENARIO = [
        (42, 120, 0, 2), (50, 160, 8, 15), (58, 210, 14, 28), (66, 300, 20, 44),
        (74, 420, 26, 60), (83, 560, 30, 72), (91, 780, 28, 80), (99, 1180, 14, 82),
    ]

    def test_predictions_are_structurally_valid(self, engine):
        start = datetime(2025, 6, 13, 14, 0, 0)
        for i, (wl, ch4, r1, r3) in enumerate(self._SCENARIO):
            ts = start + timedelta(minutes=F.SAMPLE_INTERVAL_MIN * i)
            out = engine.predict(current_time=ts, water_level=wl, methane_ppm=ch4,
                                 rainfall_1h=r1, rainfall_3h=r3)

            assert out["predicted_risk"] in F.CLASS_LABELS
            assert 0.0 <= out["confidence"] <= 1.0
            probs = out["class_probabilities"]
            assert set(probs) == set(F.CLASS_LABELS)
            assert abs(sum(probs.values()) - 1.0) < 1e-3
            assert np.isfinite(out["predicted_water_level_60min"])

    def test_sewer_index_follows_methane_thresholds(self, engine):
        # Deterministic key rule — independent of the trained classifier.
        safe = engine.predict("2025-06-13T14:00:00", 40, 100, 0, 0)
        assert safe["sewer_safety_index"]["category"] == "SAFE"
        assert safe["sewer_safety_index"]["worker_clearance"] == "ENTRY ALLOWED"

        critical = engine.predict("2025-06-13T14:05:00", 99, 1180, 14, 82)
        assert critical["sewer_safety_index"]["category"] == "CRITICAL"
        assert critical["sewer_safety_index"]["worker_clearance"] == "ENTRY PROHIBITED"
