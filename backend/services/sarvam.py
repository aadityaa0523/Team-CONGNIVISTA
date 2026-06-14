"""Sarvam AI — translation, TTS, and conversational chat.

API reference: https://docs.sarvam.ai
Header: api-subscription-key: <SARVAM_API_KEY>
All functions return a safe fallback value when the key is absent or the call fails.
"""
import base64
import logging

import httpx

from backend.config import settings

logger = logging.getLogger(__name__)

_BASE = "https://api.sarvam.ai"
_HEADERS = lambda: {"api-subscription-key": settings.sarvam_api_key, "Content-Type": "application/json"}

# Supported language codes
LANG_TELUGU = "te-IN"
LANG_TAMIL = "ta-IN"
LANG_ENGLISH = "en-IN"

# TTS speaker per language (bulbul:v2)
_SPEAKER = {
    LANG_TELUGU: "anushka",
    LANG_TAMIL: "anushka",
    LANG_ENGLISH: "anushka",
}


def translate(text: str, target_lang: str = LANG_TELUGU, source_lang: str = LANG_ENGLISH) -> str:
    """Translate text to target_lang (default Telugu).

    Returns the original text unchanged when the key is absent or the call fails.
    """
    if not settings.sarvam_api_key:
        logger.warning("SARVAM_API_KEY not set — returning untranslated text")
        return text

    try:
        resp = httpx.post(
            f"{_BASE}/translate",
            headers=_HEADERS(),
            json={
                "input": text,
                "source_language_code": source_lang,
                "target_language_code": target_lang,
                "speaker_gender": "Female",
                "mode": "formal",
                "model": "mayura:v1",
                "enable_preprocessing": False,
            },
            timeout=15,
        )
        resp.raise_for_status()
        return resp.json().get("translated_text", text)
    except Exception as exc:
        logger.warning("Sarvam translate failed (%s) — returning original text", exc)
        return text


def text_to_speech(text: str, lang: str = LANG_TELUGU) -> bytes:
    """Convert text to speech audio (WAV bytes).

    Returns an empty bytes object when the key is absent or the call fails.
    """
    if not settings.sarvam_api_key:
        logger.warning("SARVAM_API_KEY not set — returning empty audio")
        return b""

    try:
        resp = httpx.post(
            f"{_BASE}/text-to-speech",
            headers=_HEADERS(),
            json={
                "inputs": [text],
                "target_language_code": lang,
                "speaker": _SPEAKER.get(lang, "anushka"),
                "pitch": 0,
                "pace": 1.0,
                "loudness": 1.5,
                "speech_sample_rate": 8000,
                "enable_preprocessing": False,
                "model": "bulbul:v2",
            },
            timeout=30,
        )
        resp.raise_for_status()
        audios = resp.json().get("audios", [])
        if not audios:
            return b""
        return base64.b64decode(audios[0])
    except Exception as exc:
        logger.warning("Sarvam TTS failed (%s) — returning empty audio", exc)
        return b""


def chat(message: str, history: list[dict]) -> str:
    """Send a conversational message to the Sarvam chat endpoint.

    history is a list of {"role": "user"|"assistant", "content": "..."} dicts.
    Returns a plain-text response string.
    Falls back to an empty string when the key is absent or the call fails.
    """
    if not settings.sarvam_api_key:
        logger.warning("SARVAM_API_KEY not set — chat unavailable")
        return ""

    messages = [{"role": m["role"], "content": m["content"]} for m in history]
    messages.append({"role": "user", "content": message})

    try:
        resp = httpx.post(
            f"{_BASE}/v1/chat/completions",
            headers=_HEADERS(),
            json={
                "model": "sarvam-105b",
                "messages": messages,
            },
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        return data["choices"][0]["message"]["content"]
    except Exception as exc:
        logger.warning("Sarvam chat failed (%s)", exc)
        return ""
