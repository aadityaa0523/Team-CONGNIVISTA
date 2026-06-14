"""Gemini AI — situational briefings, AI analysis, XAI, and incident reports.

Uses the google-genai SDK (v2+). All functions return safe fallback values
when GEMINI_API_KEY is absent or the call fails.
"""
import json
import logging

import pandas as pd

from backend.config import settings

logger = logging.getLogger(__name__)

_MODEL = "gemini-2.5-flash"
_client = None


def _get_client():
    global _client
    if _client is None:
        from google import genai
        _client = genai.Client(api_key=settings.gemini_api_key)
    return _client


def _generate(prompt: str) -> str:
    """Send a prompt and return the text response. Returns '' on any failure."""
    if not settings.gemini_api_key:
        logger.warning("GEMINI_API_KEY not set — skipping Gemini call")
        return ""
    try:
        client = _get_client()
        response = client.models.generate_content(model=_MODEL, contents=prompt)
        return response.text.strip()
    except Exception as exc:
        logger.warning("Gemini call failed (%s)", exc)
        return ""


def generate_briefing(node_id: str, readings_df: pd.DataFrame, forecast: list[dict]) -> str:
    """Return a 2-3 sentence Telugu/English situational briefing for the node."""
    if readings_df.empty:
        current = "unknown"
        trend = "unknown"
    else:
        current = f"{readings_df['distance_cm'].iloc[-1]:.1f}"
        trend = "rising" if readings_df["distance_cm"].iloc[-1] < readings_df["distance_cm"].iloc[0] else "falling"

    forecast_2h = forecast[-1]["distance_cm_predicted"] if forecast else "unknown"

    prompt = f"""You are HydroMind, a flood early-warning AI for India.
Generate a 2-3 sentence situational briefing for monitoring point: {node_id}

Current sensor reading: {current} cm (distance from sensor to water surface; lower = higher water)
Water level trend: {trend}
2-hour forecast: {forecast_2h} cm predicted

Write in clear English. Include one key term in Telugu or Tamil where natural.
Be concise and action-oriented."""

    return _generate(prompt) or f"Water level at {node_id} is {current} cm. Forecast in 2 hours: {forecast_2h} cm."


def generate_ai_analysis(node_id: str, metrics: dict) -> dict:
    """Return structured AI analysis: summary, risk_explanation, root_cause, recommendations."""
    prompt = f"""You are HydroMind AI Flood Analyst. Analyze this drainage node.

Node: {node_id}
Metrics:
{json.dumps(metrics, indent=2)}

Respond ONLY with a valid JSON object using exactly these keys:
{{
  "summary": "1-2 sentence situation summary",
  "risk_explanation": "why risk exists (1-2 sentences)",
  "root_cause": ["cause 1", "cause 2"],
  "recommendations": ["action 1", "action 2", "action 3"]
}}"""

    raw = _generate(prompt)
    if not raw:
        return {
            "summary": f"Analysis unavailable for {node_id}.",
            "risk_explanation": "",
            "root_cause": [],
            "recommendations": [],
        }

    # Strip markdown fences if present
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = "\n".join(cleaned.split("\n")[1:])
    if cleaned.endswith("```"):
        cleaned = "\n".join(cleaned.split("\n")[:-1])

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        return {
            "summary": cleaned[:300],
            "risk_explanation": "",
            "root_cause": [],
            "recommendations": [],
        }


def explain_prediction(features: dict, prediction: str) -> str:
    """Return a plain-language XAI explanation for an ML prediction."""
    prompt = f"""You are an explainable AI assistant for HydroMind flood monitoring.

The flood risk model predicted: {prediction.upper()}

Input features used:
{json.dumps(features, indent=2)}

Explain in 2-3 plain sentences WHY the model made this prediction.
Focus on the most important feature values. Use simple language for municipal staff."""

    return _generate(prompt) or f"Risk classified as {prediction} based on current sensor readings."


def generate_incident_report(event_data: dict) -> str:
    """Return a formal incident report as a text string."""
    prompt = f"""You are HydroMind generating an official flood incident report.

Event data:
{json.dumps(event_data, indent=2)}

Write a formal incident report with these sections:
1. Incident Summary
2. Cause Analysis
3. Severity Assessment
4. Impact on Infrastructure / Population
5. Recommended Actions

Keep each section to 2-3 sentences. Use professional municipal language."""

    return _generate(prompt) or f"Incident report for {event_data.get('node_id', 'unknown node')} — data logged at {event_data.get('ts', 'unknown time')}."


def chat_response(message: str, history: list[dict], node_id: str = "") -> str:
    """Answer a flood/drainage question using Gemini with system context.

    Used by the /chat router as the AI backend for the copilot widget.
    history is a list of {"role": "user"|"assistant", "content": "..."} dicts.
    """
    system_context = (
        "You are HydroMind, an AI flood and drainage intelligence assistant for Indian cities. "
        "You monitor rivers, urban drains, and sewer safety in Andhra Pradesh, Telangana, and Tamil Nadu. "
        "Answer flood/drainage questions clearly in the same language the user writes in (English or Telugu or Tamil). "
        "If the user asks in Telugu, reply in Telugu. If Tamil, reply in Tamil. "
        f"{'Current monitoring context: node ' + node_id + '.' if node_id else ''}"
    )

    parts = [system_context, "\n\nConversation so far:\n"]
    for turn in history[-6:]:  # keep last 6 turns to stay within token budget
        role = "User" if turn["role"] == "user" else "Assistant"
        parts.append(f"{role}: {turn['content']}")
    parts.append(f"\nUser: {message}\nAssistant:")

    return _generate("\n".join(parts)) or "I'm unable to respond right now. Please try again shortly."
