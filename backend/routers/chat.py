from fastapi import APIRouter
from pydantic import BaseModel

from backend.services import gemini, sarvam

router = APIRouter()


class ChatMessage(BaseModel):
    role: str   # "user" | "assistant"
    content: str


class ChatRequest(BaseModel):
    message: str
    history: list[ChatMessage] = []
    node_id: str = ""
    lang: str = "en-IN"  # "te-IN" Telugu | "ta-IN" Tamil | "en-IN" English


class ChatResponse(BaseModel):
    response: str
    translated: bool = False


@router.post("", response_model=ChatResponse)
async def chat_endpoint(req: ChatRequest):
    """Copilot chat endpoint.

    Pipeline:
    1. Get a Gemini response with HydroMind flood context.
    2. If the user requested a non-English language, translate the response via Sarvam.
    """
    history = [{"role": m.role, "content": m.content} for m in req.history]
    response_text = gemini.chat_response(req.message, history, req.node_id)

    translated = False
    if req.lang not in ("en-IN", "en") and response_text:
        translated_text = sarvam.translate(response_text, target_lang=req.lang)
        if translated_text and translated_text != response_text:
            response_text = translated_text
            translated = True

    return ChatResponse(response=response_text, translated=translated)
