"""Tests for sewer-safety + drain-stress logic in the HydroMind Sentinel engine.

These exercise the deterministic safety indices implemented in
sentinel/hydromind_live_engine.py (``_sewer_safety_index`` and
``_drain_stress_index``). Both are ``@staticmethod`` pure functions, so they run
without loading the trained ML artifacts or xgboost.

The methane→clearance contract mirrors backend/services/sewer_safety.py; the
backend variant is additionally covered in tests/test_alert_engine.py.
"""
import sys
from pathlib import Path

import pytest

_SENTINEL_DIR = Path(__file__).resolve().parents[1] / "sentinel"
if str(_SENTINEL_DIR) not in sys.path:
    sys.path.insert(0, str(_SENTINEL_DIR))

from hydromind_live_engine import (  # noqa: E402
    METHANE_CAUTION_PPM,
    METHANE_CRITICAL_PPM,
    METHANE_DANGER_PPM,
    HydroMindSentinel,
)

_ssi = HydroMindSentinel._sewer_safety_index
_dsi = HydroMindSentinel._drain_stress_index


# ── Sewer Safety Index (Features 14–16) ──────────────────────────────────────
class TestSewerSafetyIndex:
    @pytest.mark.parametrize(
        "ppm, category, clearance",
        [
            (0, "SAFE", "ENTRY ALLOWED"),
            (100, "SAFE", "ENTRY ALLOWED"),
            (METHANE_CAUTION_PPM, "CAUTION", "ENTRY RESTRICTED"),       # boundary
            (350, "CAUTION", "ENTRY RESTRICTED"),
            (METHANE_DANGER_PPM, "DANGER", "ENTRY PROHIBITED"),         # boundary
            (700, "DANGER", "ENTRY PROHIBITED"),
            (METHANE_CRITICAL_PPM, "CRITICAL", "ENTRY PROHIBITED"),     # boundary
            (1500, "CRITICAL", "ENTRY PROHIBITED"),
        ],
    )
    def test_category_and_clearance_bands(self, ppm, category, clearance):
        result = _ssi(ppm)
        assert result["category"] == category
        assert result["worker_clearance"] == clearance
        assert result["methane_ppm"] == round(float(ppm), 1)

    def test_index_is_within_bounds_and_monotonic(self):
        # Higher methane -> lower (worse) safety index, clamped to [0, 100].
        scores = [_ssi(p)["index"] for p in (0, 250, 500, 1000, 2000)]
        assert all(0.0 <= s <= 100.0 for s in scores)
        assert scores == sorted(scores, reverse=True)
        assert _ssi(0)["index"] == 100.0
        assert _ssi(METHANE_CRITICAL_PPM)["index"] == 0.0


# ── Drain Stress Index (Feature 8) ───────────────────────────────────────────
class TestDrainStressIndex:
    def test_calm_conditions_are_safe(self):
        result = _dsi(water_level=10.0, rise_rate=0.0, rainfall_1h=0.0, methane_ppm=0.0)
        assert result["category"] == "SAFE"
        assert 0 <= result["index"] < 25

    def test_extreme_conditions_are_critical(self):
        result = _dsi(water_level=100.0, rise_rate=10.0, rainfall_1h=50.0, methane_ppm=1000.0)
        assert result["category"] == "CRITICAL"
        assert result["index"] >= 75

    @pytest.mark.parametrize(
        "index_floor, expected",
        [(75, "CRITICAL"), (50, "WARNING"), (25, "WATCH"), (0, "SAFE")],
    )
    def test_category_thresholds(self, index_floor, expected):
        # Drive the index into each band purely via fill (40% weight) + others.
        # fill contributes up to 40; rise up to 30; rain up to 20; methane up to 10.
        mapping = {
            75: dict(water_level=100.0, rise_rate=10.0, rainfall_1h=50.0, methane_ppm=1000.0),
            50: dict(water_level=100.0, rise_rate=5.0, rainfall_1h=0.0, methane_ppm=0.0),
            25: dict(water_level=65.0, rise_rate=0.0, rainfall_1h=0.0, methane_ppm=0.0),
            0: dict(water_level=10.0, rise_rate=0.0, rainfall_1h=0.0, methane_ppm=0.0),
        }
        result = _dsi(**mapping[index_floor])
        assert result["index"] >= index_floor
        assert result["category"] == expected

    def test_fill_pct_is_clamped(self):
        # Water above capacity must not push fill_pct past 100.
        over = _dsi(water_level=250.0, rise_rate=0.0, rainfall_1h=0.0, methane_ppm=0.0)
        assert over["fill_pct"] == 100.0
        assert 0 <= over["index"] <= 100

    def test_negative_rise_rate_uses_magnitude(self):
        # A rapidly *falling* level still registers operational activity.
        result = _dsi(water_level=50.0, rise_rate=-10.0, rainfall_1h=0.0, methane_ppm=0.0)
        assert result["index"] > _dsi(water_level=50.0, rise_rate=0.0,
                                      rainfall_1h=0.0, methane_ppm=0.0)["index"]
