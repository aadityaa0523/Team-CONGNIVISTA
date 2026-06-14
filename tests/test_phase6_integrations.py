"""Phase 6 integration service tests — all external API calls are mocked."""
import base64
import json
from unittest.mock import MagicMock, patch

import pandas as pd
import pytest


# ── Sarvam ────────────────────────────────────────────────────────────────────

class TestSarvamTranslate:
    def test_returns_translated_text(self, monkeypatch):
        from backend.services import sarvam
        monkeypatch.setattr(sarvam.settings, "sarvam_api_key", "test-key")

        mock_resp = MagicMock()
        mock_resp.json.return_value = {"translated_text": "నమస్కారం"}
        mock_resp.raise_for_status = MagicMock()

        with patch("backend.services.sarvam.httpx.post", return_value=mock_resp):
            result = sarvam.translate("Hello", target_lang="te-IN")

        assert result == "నమస్కారం"

    def test_fallback_when_no_key(self, monkeypatch):
        from backend.services import sarvam
        monkeypatch.setattr(sarvam.settings, "sarvam_api_key", "")
        result = sarvam.translate("Hello")
        assert result == "Hello"

    def test_fallback_on_http_error(self, monkeypatch):
        from backend.services import sarvam
        monkeypatch.setattr(sarvam.settings, "sarvam_api_key", "test-key")

        with patch("backend.services.sarvam.httpx.post", side_effect=Exception("timeout")):
            result = sarvam.translate("Hello")

        assert result == "Hello"


class TestSarvamTTS:
    def test_returns_decoded_bytes(self, monkeypatch):
        from backend.services import sarvam
        monkeypatch.setattr(sarvam.settings, "sarvam_api_key", "test-key")

        fake_audio = base64.b64encode(b"RIFF_FAKE_WAV").decode()
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"audios": [fake_audio]}
        mock_resp.raise_for_status = MagicMock()

        with patch("backend.services.sarvam.httpx.post", return_value=mock_resp):
            result = sarvam.text_to_speech("నమస్కారం", lang="te-IN")

        assert result == b"RIFF_FAKE_WAV"

    def test_returns_empty_bytes_when_no_key(self, monkeypatch):
        from backend.services import sarvam
        monkeypatch.setattr(sarvam.settings, "sarvam_api_key", "")
        assert sarvam.text_to_speech("test") == b""

    def test_returns_empty_bytes_on_error(self, monkeypatch):
        from backend.services import sarvam
        monkeypatch.setattr(sarvam.settings, "sarvam_api_key", "test-key")
        with patch("backend.services.sarvam.httpx.post", side_effect=Exception("network error")):
            assert sarvam.text_to_speech("test") == b""


class TestSarvamChat:
    def test_returns_response_text(self, monkeypatch):
        from backend.services import sarvam
        monkeypatch.setattr(sarvam.settings, "sarvam_api_key", "test-key")

        mock_resp = MagicMock()
        mock_resp.json.return_value = {
            "choices": [{"message": {"content": "వరద వస్తుంది"}}]
        }
        mock_resp.raise_for_status = MagicMock()

        with patch("backend.services.sarvam.httpx.post", return_value=mock_resp):
            result = sarvam.chat("Is flood coming?", history=[])

        assert result == "వరద వస్తుంది"

    def test_returns_empty_string_when_no_key(self, monkeypatch):
        from backend.services import sarvam
        monkeypatch.setattr(sarvam.settings, "sarvam_api_key", "")
        assert sarvam.chat("test", []) == ""


# ── Gemini ────────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def _mock_gemini_client(monkeypatch):
    """Replace the Gemini client with a mock for all gemini tests."""
    mock_response = MagicMock()
    mock_response.text = "Flood risk is elevated due to rising water levels."

    mock_client = MagicMock()
    mock_client.models.generate_content.return_value = mock_response

    import backend.services.gemini as gemini_mod
    monkeypatch.setattr(gemini_mod, "_client", mock_client)
    monkeypatch.setattr(gemini_mod.settings, "gemini_api_key", "test-key")


class TestGeminiBriefing:
    def test_returns_string(self):
        from backend.services import gemini
        df = pd.DataFrame({
            "time": pd.date_range("2024-01-01", periods=10, freq="30min"),
            "distance_cm": [85, 83, 81, 79, 77, 75, 73, 71, 69, 67],
        })
        forecast = [{"ts": "2024-01-01T01:00:00", "distance_cm_predicted": 60.0}]
        result = gemini.generate_briefing("krishna_river_01", df, forecast)
        assert isinstance(result, str)
        assert len(result) > 0

    def test_handles_empty_dataframe(self):
        from backend.services import gemini
        result = gemini.generate_briefing("test_node", pd.DataFrame(), [])
        assert isinstance(result, str)


class TestGeminiAnalysis:
    def test_returns_dict_with_required_keys(self, monkeypatch):
        from backend.services import gemini

        structured = {
            "summary": "High flood risk.",
            "risk_explanation": "Rapid water rise.",
            "root_cause": ["Heavy rainfall"],
            "recommendations": ["Deploy pumps"],
        }
        mock_response = MagicMock()
        mock_response.text = json.dumps(structured)
        gemini._client.models.generate_content.return_value = mock_response

        result = gemini.generate_ai_analysis("D001", {"fill_pct": 82, "methane_ppm": 50})
        assert "summary" in result
        assert "root_cause" in result
        assert "recommendations" in result

    def test_handles_malformed_json_gracefully(self):
        from backend.services import gemini

        mock_response = MagicMock()
        mock_response.text = "not valid json {{ broken"
        gemini._client.models.generate_content.return_value = mock_response

        result = gemini.generate_ai_analysis("D001", {})
        assert isinstance(result, dict)
        assert "summary" in result


class TestGeminiXAI:
    def test_returns_string(self):
        from backend.services import gemini
        result = gemini.explain_prediction({"fill_pct": 82, "rise_rate": 3.2}, "WARNING")
        assert isinstance(result, str)


class TestGeminiIncidentReport:
    def test_returns_string(self):
        from backend.services import gemini
        result = gemini.generate_incident_report(
            {"node_id": "D001", "level": "red", "ts": "2024-01-01T12:00:00"}
        )
        assert isinstance(result, str)


# ── Twilio ────────────────────────────────────────────────────────────────────

class TestTwilio:
    def test_send_sms_calls_twilio(self, monkeypatch):
        from backend.services import twilio_sms
        monkeypatch.setattr(twilio_sms.settings, "twilio_account_sid", "ACtest")
        monkeypatch.setattr(twilio_sms.settings, "twilio_auth_token", "authtest")
        monkeypatch.setattr(twilio_sms.settings, "twilio_from_number", "+10000000000")
        monkeypatch.setattr(twilio_sms, "_twilio_client", None)

        mock_client = MagicMock()
        mock_client.messages.create.return_value = MagicMock(sid="SM123")

        with patch("twilio.rest.Client", return_value=mock_client):
            twilio_sms.send_sms("+919876543210", "Flood alert!")

        mock_client.messages.create.assert_called_once()

    def test_send_sms_skips_when_no_credentials(self, monkeypatch):
        from backend.services import twilio_sms
        monkeypatch.setattr(twilio_sms.settings, "twilio_account_sid", "")
        twilio_sms.send_sms("+919876543210", "test")  # should not raise

    def test_voice_call_skips_when_no_credentials(self, monkeypatch):
        from backend.services import twilio_sms
        monkeypatch.setattr(twilio_sms.settings, "twilio_account_sid", "")
        twilio_sms.make_voice_call("+919876543210", "https://example.com/twiml")  # should not raise
