"""Phase 7 tests — alert_engine classify_flood, evaluate debounce, and sewer_safety."""
import asyncio
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# ── classify_flood ─────────────────────────────────────────────────────────────

class TestClassifyFlood:
    """classify_flood returns the correct level for each threshold band."""

    def _forecast(self, cm: float) -> list[dict]:
        return [{"ts": "2024-01-01T01:00:00", "distance_cm_predicted": cm}]

    def test_green_when_above_all_thresholds(self, monkeypatch):
        from backend.services.alert_engine import classify_flood
        from backend.services import alert_engine
        monkeypatch.setattr(alert_engine.settings, "alert_yellow_cm", 80)
        monkeypatch.setattr(alert_engine.settings, "alert_orange_cm", 60)
        monkeypatch.setattr(alert_engine.settings, "alert_red_cm", 40)
        assert classify_flood(100.0, self._forecast(100.0)) == "green"

    def test_yellow_at_threshold(self, monkeypatch):
        from backend.services.alert_engine import classify_flood
        from backend.services import alert_engine
        monkeypatch.setattr(alert_engine.settings, "alert_yellow_cm", 80)
        monkeypatch.setattr(alert_engine.settings, "alert_orange_cm", 60)
        monkeypatch.setattr(alert_engine.settings, "alert_red_cm", 40)
        assert classify_flood(80.0, self._forecast(100.0)) == "yellow"

    def test_orange_at_threshold(self, monkeypatch):
        from backend.services.alert_engine import classify_flood
        from backend.services import alert_engine
        monkeypatch.setattr(alert_engine.settings, "alert_yellow_cm", 80)
        monkeypatch.setattr(alert_engine.settings, "alert_orange_cm", 60)
        monkeypatch.setattr(alert_engine.settings, "alert_red_cm", 40)
        assert classify_flood(60.0, self._forecast(100.0)) == "orange"

    def test_red_at_threshold(self, monkeypatch):
        from backend.services.alert_engine import classify_flood
        from backend.services import alert_engine
        monkeypatch.setattr(alert_engine.settings, "alert_yellow_cm", 80)
        monkeypatch.setattr(alert_engine.settings, "alert_orange_cm", 60)
        monkeypatch.setattr(alert_engine.settings, "alert_red_cm", 40)
        assert classify_flood(40.0, self._forecast(100.0)) == "red"

    def test_escalates_to_red_via_forecast(self, monkeypatch):
        """Current reading is safe but forecast crosses RED threshold — must return red."""
        from backend.services.alert_engine import classify_flood
        from backend.services import alert_engine
        monkeypatch.setattr(alert_engine.settings, "alert_yellow_cm", 80)
        monkeypatch.setattr(alert_engine.settings, "alert_orange_cm", 60)
        monkeypatch.setattr(alert_engine.settings, "alert_red_cm", 40)
        assert classify_flood(90.0, self._forecast(35.0)) == "red"

    def test_empty_forecast_uses_current(self, monkeypatch):
        from backend.services.alert_engine import classify_flood
        from backend.services import alert_engine
        monkeypatch.setattr(alert_engine.settings, "alert_yellow_cm", 80)
        monkeypatch.setattr(alert_engine.settings, "alert_orange_cm", 60)
        monkeypatch.setattr(alert_engine.settings, "alert_red_cm", 40)
        assert classify_flood(90.0, []) == "green"


# ── sewer_safety ───────────────────────────────────────────────────────────────

class TestSewerSafety:
    def test_safe_below_caution(self, monkeypatch):
        from backend.services import sewer_safety
        monkeypatch.setattr(sewer_safety.settings, "methane_caution_ppm", 200)
        monkeypatch.setattr(sewer_safety.settings, "methane_danger_ppm", 500)
        monkeypatch.setattr(sewer_safety.settings, "methane_critical_ppm", 1000)
        result = sewer_safety.evaluate_sewer("D001", 100.0)
        assert result["sewer_safety_index"] == "SAFE"
        assert result["worker_clearance"] == "ENTRY ALLOWED"

    def test_caution_band(self, monkeypatch):
        from backend.services import sewer_safety
        monkeypatch.setattr(sewer_safety.settings, "methane_caution_ppm", 200)
        monkeypatch.setattr(sewer_safety.settings, "methane_danger_ppm", 500)
        monkeypatch.setattr(sewer_safety.settings, "methane_critical_ppm", 1000)
        result = sewer_safety.evaluate_sewer("D001", 300.0)
        assert result["sewer_safety_index"] == "CAUTION"
        assert result["worker_clearance"] == "ENTRY RESTRICTED"

    def test_danger_band(self, monkeypatch):
        from backend.services import sewer_safety
        monkeypatch.setattr(sewer_safety.settings, "methane_caution_ppm", 200)
        monkeypatch.setattr(sewer_safety.settings, "methane_danger_ppm", 500)
        monkeypatch.setattr(sewer_safety.settings, "methane_critical_ppm", 1000)
        result = sewer_safety.evaluate_sewer("D001", 600.0)
        assert result["sewer_safety_index"] == "DANGER"
        assert result["worker_clearance"] == "ENTRY PROHIBITED"

    def test_critical_band(self, monkeypatch):
        from backend.services import sewer_safety
        monkeypatch.setattr(sewer_safety.settings, "methane_caution_ppm", 200)
        monkeypatch.setattr(sewer_safety.settings, "methane_danger_ppm", 500)
        monkeypatch.setattr(sewer_safety.settings, "methane_critical_ppm", 1000)
        result = sewer_safety.evaluate_sewer("D001", 1200.0)
        assert result["sewer_safety_index"] == "CRITICAL"
        assert result["worker_clearance"] == "ENTRY PROHIBITED"


# ── evaluate() — integration ──────────────────────────────────────────────────

@pytest.fixture()
def _clear_debounce():
    """Reset the in-memory debounce dict between tests."""
    from backend.services import alert_engine
    alert_engine._last_alert.clear()
    yield
    alert_engine._last_alert.clear()


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


@pytest.fixture(autouse=True)
def _patch_all_externals(monkeypatch):
    """Stub every I/O call in evaluate() so tests run without infrastructure."""
    import pandas as pd
    from backend.services import (
        alert_engine, classifier, forecaster, gemini,
        influx, mongo, sarvam, twilio_sms,
    )

    monkeypatch.setattr(influx, "get_latest", lambda node_id: 35.0)  # below RED_CM=40
    monkeypatch.setattr(influx, "get_latest_methane", lambda node_id: 50.0)
    monkeypatch.setattr(influx, "query_readings", lambda node_id, hours=6: pd.DataFrame(
        {"time": pd.date_range("2024-01-01", periods=5, freq="30s", tz="UTC"),
         "distance_cm": [60.0, 55.0, 50.0, 45.0, 35.0]}
    ))
    monkeypatch.setattr(forecaster, "predict", lambda node_id: [
        {"ts": "2024-01-01T01:00:00", "distance_cm_predicted": 30.0}
    ])
    monkeypatch.setattr(classifier, "predict_flood_risk", lambda f: {"class": "CRITICAL", "probability": 0.95})
    monkeypatch.setattr(classifier, "predict_ttf", lambda f: 25.0)
    monkeypatch.setattr(classifier, "detect_anomaly", lambda f: (False, ""))
    monkeypatch.setattr(gemini, "generate_briefing", lambda *a, **kw: "Flood risk is high.")
    monkeypatch.setattr(gemini, "generate_ai_analysis", lambda *a, **kw: {"summary": "Critical"})
    monkeypatch.setattr(gemini, "explain_prediction", lambda *a, **kw: "Water rose rapidly.")
    monkeypatch.setattr(sarvam, "translate", lambda text, **kw: text)
    monkeypatch.setattr(sarvam, "text_to_speech", lambda *a, **kw: b"")
    monkeypatch.setattr(mongo, "insert_alert", AsyncMock())
    monkeypatch.setattr(mongo, "get_subscribers", AsyncMock(return_value=["+919876543210"]))
    monkeypatch.setattr(twilio_sms, "send_sms", MagicMock())
    monkeypatch.setattr(twilio_sms, "make_voice_call", MagicMock())
    monkeypatch.setattr(alert_engine, "_fire_n8n", MagicMock())
    monkeypatch.setattr(alert_engine.manager, "broadcast", AsyncMock())

    monkeypatch.setattr(alert_engine.settings, "alert_yellow_cm", 80)
    monkeypatch.setattr(alert_engine.settings, "alert_orange_cm", 60)
    monkeypatch.setattr(alert_engine.settings, "alert_red_cm", 40)
    monkeypatch.setattr(alert_engine.settings, "methane_caution_ppm", 200)
    monkeypatch.setattr(alert_engine.settings, "methane_danger_ppm", 500)
    monkeypatch.setattr(alert_engine.settings, "methane_critical_ppm", 1000)


class TestEvaluate:
    def test_alert_dispatched_on_red_level(self, _clear_debounce):
        from backend.services import alert_engine, mongo, twilio_sms
        _run(alert_engine.evaluate("krishna_river_01"))
        mongo.insert_alert.assert_called_once()

    def test_voice_call_triggered_on_red(self, _clear_debounce):
        from backend.services import alert_engine, twilio_sms
        _run(alert_engine.evaluate("krishna_river_01"))
        twilio_sms.make_voice_call.assert_called_once()

    def test_debounce_prevents_second_broadcast(self, _clear_debounce):
        from backend.services import alert_engine, mongo
        _run(alert_engine.evaluate("krishna_river_01"))
        _run(alert_engine.evaluate("krishna_river_01"))
        # Second call should be debounced — insert_alert called exactly once
        assert mongo.insert_alert.call_count == 1

    def test_debounce_resets_on_level_change(self, _clear_debounce, monkeypatch):
        from backend.services import alert_engine, mongo
        _run(alert_engine.evaluate("krishna_river_01"))
        # Change to orange level
        monkeypatch.setattr(alert_engine, "classify_flood", lambda *a: "orange")
        _run(alert_engine.evaluate("krishna_river_01"))
        assert mongo.insert_alert.call_count == 2

    def test_no_alert_when_green_and_safe(self, _clear_debounce, monkeypatch):
        from backend.services import alert_engine, forecaster, influx, mongo
        monkeypatch.setattr(influx, "get_latest", lambda node_id: 150.0)  # above all thresholds
        monkeypatch.setattr(influx, "get_latest_methane", lambda node_id: 10.0)  # below caution
        # Forecast must also be safe so classify_flood doesn't escalate to RED
        monkeypatch.setattr(forecaster, "predict", lambda node_id: [
            {"ts": "2024-01-01T01:00:00", "distance_cm_predicted": 150.0}
        ])
        _run(alert_engine.evaluate("krishna_river_01"))
        mongo.insert_alert.assert_not_called()

    def test_returns_early_when_no_sensor_data(self, _clear_debounce, monkeypatch):
        from backend.services import alert_engine, influx, mongo
        monkeypatch.setattr(influx, "get_latest", lambda node_id: None)
        _run(alert_engine.evaluate("krishna_river_01"))
        mongo.insert_alert.assert_not_called()

    def test_sms_sent_to_subscribers(self, _clear_debounce):
        from backend.services import alert_engine, twilio_sms
        _run(alert_engine.evaluate("krishna_river_01"))
        twilio_sms.send_sms.assert_called_once()
        call_args = twilio_sms.send_sms.call_args[0]
        assert call_args[0] == "+919876543210"
        assert isinstance(call_args[1], str) and len(call_args[1]) > 0

    def test_websocket_broadcast_called(self, _clear_debounce):
        from backend.services import alert_engine
        _run(alert_engine.evaluate("krishna_river_01"))
        alert_engine.manager.broadcast.assert_called_once()
