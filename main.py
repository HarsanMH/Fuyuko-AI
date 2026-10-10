import os
import time
from collections import defaultdict, deque
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
KNOWLEDGE_FILE = BASE_DIR / "knowledge" / "minecraft_rules.txt"

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "").strip()
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4.1-mini").strip()
APP_ACCESS_PASSWORD = os.getenv("APP_ACCESS_PASSWORD", "").strip()
MAX_REQUESTS_PER_MINUTE = int(os.getenv("MAX_REQUESTS_PER_MINUTE", "12"))

app = FastAPI(title="Fuyuko AI", docs_url=None, redoc_url=None)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# Simple in-memory rate limit. On multi-instance deployments, use a shared store.
_request_times = defaultdict(deque)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=8000)
    history: list[dict] = Field(default_factory=list)


def check_rate_limit(request: Request) -> None:
    host = request.client.host if request.client else "unknown"
    now = time.time()
    queue = _request_times[host]
    while queue and now - queue[0] > 60:
        queue.popleft()
    if len(queue) >= MAX_REQUESTS_PER_MINUTE:
        raise HTTPException(status_code=429, detail="Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.")
    queue.append(now)


def check_access(request: Request) -> None:
    # Set APP_ACCESS_PASSWORD in the hosting dashboard before publishing.
    if APP_ACCESS_PASSWORD:
        supplied = request.headers.get("x-app-password", "")
        if supplied != APP_ACCESS_PASSWORD:
            raise HTTPException(status_code=401, detail="Kode akses salah atau belum diisi.")


def get_system_instruction(language: str) -> str:
    knowledge = ""
    try:
        knowledge = KNOWLEDGE_FILE.read_text(encoding="utf-8").strip()
    except OSError:
        pass

    language_instruction = (
        "Jawab dalam Bahasa Indonesia, kecuali pengguna meminta bahasa lain."
        if language == "id"
        else "Answer in English unless the user asks for another language."
    )

    base = f"""
You are Fuyuko AI, an assistant specializing in Minecraft Bedrock Edition add-ons.
{language_instruction}

Rules:
- Do not invent Minecraft JSON properties, components, or Script API methods.
- If a feature/version detail is uncertain, say so and recommend checking official
  Minecraft Creator documentation: https://learn.microsoft.com/minecraft/creator/
- Distinguish Bedrock Edition from Java Edition.
- When providing code, state the exact file path and explain where it belongs.
- Preserve existing UUIDs unless the user explicitly asks to change them.
- If asked to edit existing files, inspect the supplied content and avoid unrelated changes.
- Do not claim code was tested unless it actually was.
- For JSON, produce valid JSON without comments when the user asks for a complete file.
- Be clear about version dependencies and experimental toggles when relevant.

Project knowledge supplied by the owner:
{knowledge if knowledge else "(No additional project knowledge file found.)"}
"""
    return base.strip()


@app.get("/")
async def index():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/manifest.json")
async def manifest():
    return FileResponse(STATIC_DIR / "manifest.json", media_type="application/manifest+json")


@app.get("/sw.js")
async def service_worker():
    # Service worker must be served from the site root for root scope.
    return FileResponse(STATIC_DIR / "sw.js", media_type="application/javascript",
                        headers={"Cache-Control": "no-cache"})


@app.get("/api/health")
async def health():
    return {"ok": True, "app": "Fuyuko AI", "model": OPENAI_MODEL,
            "access_code_required": bool(APP_ACCESS_PASSWORD)}


@app.post("/api/access")
async def check_access_code(request: Request):
    # Rate-limit access-code attempts without spending an AI request.
    check_rate_limit(request)
    if APP_ACCESS_PASSWORD:
        supplied = request.headers.get("x-app-password", "")
        if supplied != APP_ACCESS_PASSWORD:
            raise HTTPException(status_code=401, detail="Kode akses salah atau belum diisi.")
    return {"ok": True}


@app.post("/api/chat")
async def chat(payload: ChatRequest, request: Request):
    check_access(request)
    check_rate_limit(request)

    if not OPENAI_API_KEY:
        raise HTTPException(status_code=503, detail="Server belum dikonfigurasi: OPENAI_API_KEY belum diatur.")

    message = payload.message.strip()
    if not message:
        raise HTTPException(status_code=400, detail="Pesan tidak boleh kosong.")

    language = request.headers.get("x-app-language", "id")
    if language not in ("id", "en"):
        language = "id"

    # Only accept a small, well-formed history from the browser.
    input_items = []
    for item in payload.history[-12:]:
        role = item.get("role")
        text = item.get("text")
        if role in ("user", "assistant", "model") and isinstance(text, str) and text.strip():
            mapped_role = "assistant" if role in ("assistant", "model") else "user"
            input_items.append({"role": mapped_role, "content": text[:8000]})
    input_items.append({"role": "user", "content": message})

    body = {
        "model": OPENAI_MODEL,
        "instructions": get_system_instruction(language),
        "input": input_items,
        "max_output_tokens": 2048,
        "store": False,
    }
    url = "https://api.openai.com/v1/responses"

    try:
        async with httpx.AsyncClient(timeout=90.0) as client:
            response = await client.post(
                url,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {OPENAI_API_KEY}",
                },
                json=body,
            )
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="AI terlalu lama merespons. Coba lagi.")
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="Tidak dapat terhubung ke layanan AI.")

    if response.status_code >= 400:
        # Do not return the API key or request headers to the browser.
        try:
            detail = response.json().get("error", {}).get("message", "Permintaan AI gagal.")
        except ValueError:
            detail = "Permintaan AI gagal."
        if response.status_code in (400, 401, 403, 404, 429):
            raise HTTPException(status_code=502, detail=f"OpenAI menolak permintaan: {detail[:500]}")
        raise HTTPException(status_code=502, detail="Layanan OpenAI mengalami masalah. Coba lagi nanti.")

    try:
        data = response.json()
        answer = data.get("output_text", "")
        if not answer:
            text_parts = []
            for item in data.get("output", []):
                if item.get("type") == "message":
                    for part in item.get("content", []):
                        if part.get("type") == "output_text" and isinstance(part.get("text"), str):
                            text_parts.append(part["text"])
            answer = "\n".join(text_parts)
    except (ValueError, KeyError, IndexError, TypeError):
        answer = ""

    if not answer:
        raise HTTPException(status_code=502, detail="AI tidak mengembalikan jawaban teks. Coba pertanyaan lain.")

    return JSONResponse({"answer": answer})


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=int(os.getenv("PORT", "8000")))
