"""Tests for backend.services.forecaster — train / predict / edge cases."""
import numpy as np
import pandas as pd
import pytest


def _make_df(n: int = 5760) -> pd.DataFrame:
    """Synthetic DataFrame[time, distance_cm] with n rows at 30-second cadence."""
    times = pd.date_range("2024-01-01", periods=n, freq="30s", tz="UTC")
    rng = np.random.default_rng(42)
    dist = 80 + np.cumsum(rng.standard_normal(n) * 0.3)
    return pd.DataFrame({"time": times, "distance_cm": dist})


@pytest.fixture(autouse=True)
def _patch_influx_weather(monkeypatch):
    """Redirect InfluxDB and OWM calls to in-memory stubs for every test."""
    from backend.services import influx, weather

    monkeypatch.setattr(influx, "query_readings", lambda node_id, hours=48: _make_df())
    monkeypatch.setattr(weather, "get_historical_rainfall", lambda lat, lon, hours=48: [0.0] * hours)
    monkeypatch.setattr(weather, "get_rainfall_forecast", lambda lat, lon: [0.0, 0.0, 0.0, 0.0])


@pytest.fixture()
def model_dir(tmp_path, monkeypatch):
    """Point forecaster at a temp directory so tests don't touch models/."""
    from backend.services import forecaster

    monkeypatch.setattr(forecaster, "_MODELS_DIR", tmp_path)
    return tmp_path


class TestTrain:
    def test_creates_pickle(self, model_dir):
        from backend.services import forecaster

        forecaster.train("test_node")
        assert (model_dir / "test_node.pkl").exists()

    def test_raises_on_empty_data(self, model_dir, monkeypatch):
        from backend.services import forecaster, influx

        monkeypatch.setattr(influx, "query_readings", lambda *a, **kw: pd.DataFrame(columns=["time", "distance_cm"]))
        with pytest.raises(ValueError, match="Not enough data"):
            forecaster.train("empty_node")

    def test_raises_on_sparse_data(self, model_dir, monkeypatch):
        from backend.services import forecaster, influx

        monkeypatch.setattr(influx, "query_readings", lambda *a, **kw: _make_df(5))
        with pytest.raises(ValueError, match="Not enough data"):
            forecaster.train("sparse_node")


class TestPredict:
    def test_returns_4_steps(self, model_dir):
        from backend.services import forecaster

        forecaster.train("test_node")
        steps = forecaster.predict("test_node")
        assert len(steps) == 4

    def test_step_schema(self, model_dir):
        from backend.services import forecaster

        forecaster.train("test_node")
        for step in forecaster.predict("test_node"):
            assert "ts" in step
            assert "distance_cm_predicted" in step
            assert isinstance(step["distance_cm_predicted"], float)

    def test_timestamps_are_30min_apart(self, model_dir):
        from backend.services import forecaster
        from datetime import datetime

        forecaster.train("test_node")
        steps = forecaster.predict("test_node")
        ts = [datetime.fromisoformat(s["ts"]) for s in steps]
        gaps = [(ts[i + 1] - ts[i]).total_seconds() for i in range(3)]
        assert all(g == 1800 for g in gaps), f"Expected 1800s gaps, got {gaps}"

    def test_raises_when_no_model(self, model_dir):
        from backend.services import forecaster

        with pytest.raises(FileNotFoundError):
            forecaster.predict("untrained_node")
print("nihal")