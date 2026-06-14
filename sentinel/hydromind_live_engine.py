"""HydroMind Sentinel — File 2: live ESP32 inference engine.

Loads the artifacts produced by ``model_validation.py`` and turns a stream of
live sensor readings into an actionable risk assessment, 60 minutes ahead.

Inputs per reading (from an ESP32 node):
    current_time, water_level, methane_ppm, rainfall_1h, rainfall_3h
    (rise_rate is derived automatically from consecutive readings)

Outputs:
    predicted_risk                      SAFE / WATCH / WARNING / CRITICAL
    confidence                          classifier probability of that class
    predicted_water_level_60min         ARIMAX Stage-1 forecast (cm)
    sewer_safety_index                  methane-driven worker-safety score
    drain_stress_index                  operational stress score 0..100

The engine keeps an in-memory rolling history buffer so it can reconstruct the
EXACT same lag/rolling/ARIMAX features the model was trained on (via the shared
``features`` module — no train/serve skew).

Usage
-----
    python sentinel/hydromind_live_engine.py            # runs a simulated demo

    # or programmatically:
    from hydromind_live_engine import HydroMindSentinel
    engine = HydroMindSentinel()
    result = engine.predict(current_time="2025-06-13T14:30:00",
                            water_level=82.0, methane_ppm=540,
                            rainfall_1h=18.0, rainfall_3h=46.0)
"""
from __future__ import annotations

import json
import os
import pickle
import sys
from collections import deque
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import features as F  # noqa: E402

_PROJECT_ROOT = Path(__file__).resolve().parents[1]
_ARTIFACT_DIR = _PROJECT_ROOT / "models" / "sentinel"

# Domain thresholds mirrored from backend/services (sewer_safety.py, config.py)
# so the standalone engine stays self-contained.
METHANE_CAUTION_PPM = 200
METHANE_DANGER_PPM = 500
METHANE_CRITICAL_PPM = 1000
DRAIN_CAPACITY_CM = 100.0   # fill-% reference for the stress index


class HydroMindSentinel:
    """Stateful live predictor backed by the trained ARIMAX + XGBoost ensemble."""

    def __init__(self, artifact_dir: Path | str = _ARTIFACT_DIR, history_size: int = 400):
        self.artifact_dir = Path(artifact_dir)
        self._load_artifacts()
        # Rolling buffer of recent readings (one dict per timestep).
        self.history: deque[dict] = deque(maxlen=history_size)

    # ------------------------------------------------------------------ #
    # Artifact loading                                                   #
    # ------------------------------------------------------------------ #
    def _load_artifacts(self) -> None:
        meta_path = self.artifact_dir / "metadata.json"
        if not meta_path.exists():
            raise FileNotFoundError(
                f"No trained artifacts in {self.artifact_dir}. "
                "Run `python sentinel/model_validation.py` first."
            )
        with open(meta_path, encoding="utf-8") as fh:
            self.meta = json.load(fh)

        from xgboost import XGBClassifier
        self.clf = XGBClassifier()
        self.clf.load_model(str(self.artifact_dir / "xgb_classifier.json"))

        with open(self.artifact_dir / "arimax.pkl", "rb") as fh:
            self.arimax = pickle.load(fh)

        self.feature_columns = self.meta["feature_columns"]
        self.class_labels = self.meta["class_labels"]
        self.horizon = int(self.meta["horizon_steps"])
        self.interval_min = float(self.meta["sample_interval_min"])
        self.window = int(self.meta["rolling_window"])
        self.warmup = int(self.meta["arimax_warmup"])
        self.medians = self.meta["feature_medians"]
        print(f"[engine] Loaded model (horizon={self.horizon} rows, "
              f"interval≈{self.interval_min:.1f} min, "
              f"trained_at={self.meta.get('trained_at')})")

    # ------------------------------------------------------------------ #
    # Core prediction                                                    #
    # ------------------------------------------------------------------ #
    def predict(
        self,
        current_time,
        water_level: float,
        methane_ppm: float,
        rainfall_1h: float,
        rainfall_3h: float,
        rise_rate: float | None = None,
    ) -> dict:
        """Ingest one live reading and return the full risk assessment dict."""
        ts = self._parse_time(current_time)

        # Derive rise_rate from the previous reading if the node did not send it.
        if rise_rate is None:
            rise_rate = self._derive_rise_rate(water_level, ts)

        reading = {
            "timestamp": ts,
            "hour": ts.hour,
            "minute": ts.minute,
            "water_level": float(water_level),
            "rise_rate": float(rise_rate),
            "rainfall_1h": float(rainfall_1h),
            "rainfall_3h": float(rainfall_3h),
            "methane_ppm": float(methane_ppm),
        }
        self.history.append(reading)

        # Build the feature row from the rolling buffer (shared pipeline).
        feature_row, predicted_wl, arimax_method = self._build_features()

        # Stage-2 classification.
        x = np.array([[feature_row.get(c, self.medians.get(c, 0.0))
                       for c in self.feature_columns]], dtype=float)
        proba = self.clf.predict_proba(x)[0]
        class_idx = int(np.argmax(proba))
        predicted_risk = self.class_labels[class_idx]
        confidence = float(proba[class_idx])

        # Auxiliary safety indices.
        sewer = self._sewer_safety_index(methane_ppm)
        stress = self._drain_stress_index(water_level, rise_rate, rainfall_1h, methane_ppm)

        return {
            "timestamp": ts.isoformat(),
            "predicted_risk": predicted_risk,
            "confidence": round(confidence, 4),
            "class_probabilities": {
                self.class_labels[i]: round(float(p), 4) for i, p in enumerate(proba)
            },
            "predicted_water_level_60min": round(predicted_wl, 2),
            "arimax_method": arimax_method,
            "sewer_safety_index": sewer,
            "drain_stress_index": stress,
        }

    # ------------------------------------------------------------------ #
    # Feature construction from the live buffer                          #
    # ------------------------------------------------------------------ #
    def _build_features(self) -> tuple[dict, float, str]:
        """Recreate the trained feature vector from buffered history."""
        hist = pd.DataFrame(list(self.history))
        hist = F.engineer_base_features(hist, window=self.window)

        # Stage-1 ARIMAX forecast of water level 60 min ahead.
        predicted_wl, method = F.live_arimax_forecast(
            self.arimax, hist, horizon=self.horizon, warmup=self.warmup
        )

        last = hist.iloc[-1].to_dict()
        last[F.ARIMAX_FEATURE] = predicted_wl
        return last, predicted_wl, method

    def _derive_rise_rate(self, water_level: float, ts: datetime) -> float:
        """cm/min change vs. the previous reading; 0 on the first sample."""
        if not self.history:
            return 0.0
        prev = self.history[-1]
        dt_min = max((ts - prev["timestamp"]).total_seconds() / 60.0, 1e-6)
        return (float(water_level) - prev["water_level"]) / dt_min

    @staticmethod
    def _parse_time(current_time) -> datetime:
        """Accept ISO strings, datetime objects, or unix epoch (s or ms)."""
        if isinstance(current_time, datetime):
            return current_time
        if isinstance(current_time, (int, float)):
            secs = current_time / 1000.0 if current_time > 1e11 else current_time
            return datetime.fromtimestamp(secs, tz=timezone.utc).replace(tzinfo=None)
        return pd.to_datetime(current_time).to_pydatetime()

    # ------------------------------------------------------------------ #
    # Auxiliary safety indices (mirror backend/services domain logic)    #
    # ------------------------------------------------------------------ #
    @staticmethod
    def _sewer_safety_index(methane_ppm: float) -> dict:
        """Methane-driven worker-safety assessment.

        ``index`` is 0..100 where higher = safer (100 at 0 ppm, 0 at the
        critical threshold). Category + clearance mirror
        backend/services/sewer_safety.py.
        """
        if methane_ppm >= METHANE_CRITICAL_PPM:
            category, clearance = "CRITICAL", "ENTRY PROHIBITED"
        elif methane_ppm >= METHANE_DANGER_PPM:
            category, clearance = "DANGER", "ENTRY PROHIBITED"
        elif methane_ppm >= METHANE_CAUTION_PPM:
            category, clearance = "CAUTION", "ENTRY RESTRICTED"
        else:
            category, clearance = "SAFE", "ENTRY ALLOWED"
        index = float(np.clip(100.0 * (1.0 - methane_ppm / METHANE_CRITICAL_PPM), 0, 100))
        return {
            "index": round(index, 1),
            "category": category,
            "worker_clearance": clearance,
            "methane_ppm": round(float(methane_ppm), 1),
        }

    @staticmethod
    def _drain_stress_index(water_level: float, rise_rate: float,
                            rainfall_1h: float, methane_ppm: float) -> dict:
        """Operational stress 0..100 (mirrors digital_twin.compute_stress_index).

        Weighted: fill (40%) · rise_rate (30%) · rainfall (20%) · methane (10%).
        """
        fill_pct = min(100.0, max(0.0, water_level / DRAIN_CAPACITY_CM * 100.0))
        w_fill = min(1.0, fill_pct / 100.0) * 40
        w_rise = min(1.0, abs(rise_rate) / 10.0) * 30
        w_rain = min(1.0, rainfall_1h / 50.0) * 20
        w_ch4 = min(1.0, methane_ppm / 1000.0) * 10
        index = round(w_fill + w_rise + w_rain + w_ch4)

        if index >= 75:
            category = "CRITICAL"
        elif index >= 50:
            category = "WARNING"
        elif index >= 25:
            category = "WATCH"
        else:
            category = "SAFE"
        return {"index": index, "category": category, "fill_pct": round(fill_pct, 1)}


# --------------------------------------------------------------------------- #
# Demo                                                                        #
# --------------------------------------------------------------------------- #
def _demo() -> None:
    """Feed a short synthetic escalation sequence through the engine."""
    from datetime import timedelta

    engine = HydroMindSentinel()
    print("\n[demo] Streaming a rising-flood scenario through the live engine...\n")

    start = datetime(2025, 6, 13, 14, 0, 0)
    # Water + methane climb over the sequence to push risk upward.
    scenario = [
        # (water_level, methane_ppm, rainfall_1h, rainfall_3h)
        (42, 120, 0, 2), (45, 130, 3, 6), (50, 160, 8, 15), (58, 210, 14, 28),
        (66, 300, 20, 44), (74, 420, 26, 60), (83, 560, 30, 72), (91, 780, 28, 80),
        (97, 1020, 22, 84), (99, 1180, 14, 82),
    ]

    for i, (wl, ch4, r1, r3) in enumerate(scenario):
        ts = start + timedelta(minutes=F.SAMPLE_INTERVAL_MIN * i)
        out = engine.predict(current_time=ts, water_level=wl, methane_ppm=ch4,
                             rainfall_1h=r1, rainfall_3h=r3)
        print(
            f"t={ts:%H:%M} wl={wl:>3}cm ch4={ch4:>4}ppm | "
            f"RISK={out['predicted_risk']:<8} conf={out['confidence']:.2f} | "
            f"wl@+60m={out['predicted_water_level_60min']:>6}cm "
            f"({out['arimax_method']}) | "
            f"sewer={out['sewer_safety_index']['category']:<8} "
            f"stress={out['drain_stress_index']['index']:>3}"
        )


if __name__ == "__main__":
    _demo()
