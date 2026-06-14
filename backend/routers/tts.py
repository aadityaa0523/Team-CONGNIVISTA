"""Text-to-Speech endpoint — returns real Sarvam AI audio bytes."""
from fastapi import APIRouter
from fastapi.responses import Response
from pydantic import BaseModel

from backend.services import sarvam

router = APIRouter()


class TTSRequest(BaseModel):
    text: str
    lang: str = "te-IN"   # te-IN | ta-IN | en-IN


@router.post("")
async def tts(req: TTSRequest):
    """Convert text to speech using Sarvam AI. Returns WAV audio bytes."""
    audio = sarvam.text_to_speech(req.text, lang=req.lang)
    if not audio:
        return Response(status_code=204)
    return Response(content=audio, media_type="audio/wav")
