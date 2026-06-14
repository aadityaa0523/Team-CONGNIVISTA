"""Twilio — SMS dispatch and outbound voice calls.

Returns silently (logs a warning) when credentials are absent or the call fails,
so the rest of the alert pipeline continues uninterrupted.
"""
import logging

from backend.config import settings

logger = logging.getLogger(__name__)

_twilio_client = None


def _get_client():
    global _twilio_client
    if _twilio_client is None:
        from twilio.rest import Client
        _twilio_client = Client(settings.twilio_account_sid, settings.twilio_auth_token)
    return _twilio_client


def send_sms(to: str, body: str) -> None:
    """Send an SMS to `to` (E.164 format, e.g. '+919876543210')."""
    if not (settings.twilio_account_sid and settings.twilio_auth_token and settings.twilio_from_number):
        logger.warning("Twilio credentials not configured — SMS to %s skipped", to)
        return

    try:
        client = _get_client()
        msg = client.messages.create(
            body=body,
            from_=settings.twilio_from_number,
            to=to,
        )
        logger.info("SMS sent to %s (SID=%s)", to, msg.sid)
    except Exception as exc:
        logger.error("Twilio SMS failed to %s: %s", to, exc)


def make_voice_call(to: str, message: str) -> None:
    """Initiate an outbound voice call that reads `message` aloud via TTS."""
    if not (settings.twilio_account_sid and settings.twilio_auth_token and settings.twilio_from_number):
        logger.warning("Twilio credentials not configured — voice call to %s skipped", to)
        return

    twiml = f'<Response><Say voice="alice" language="en-IN">{message}</Say></Response>'
    try:
        client = _get_client()
        call = client.calls.create(
            twiml=twiml,
            to=to,
            from_=settings.twilio_from_number,
        )
        logger.info("Voice call initiated to %s (SID=%s)", to, call.sid)
    except Exception as exc:
        logger.error("Twilio voice call failed to %s: %s", to, exc)
