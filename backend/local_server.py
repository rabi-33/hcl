"""FastAPI local server running the exact same core logic as AWS Lambda."""

import logging
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass

from core.service import (
    get_all_tickets_payload,
    get_health_status,
    handle_civic_chat,
    seed_demo_tickets,
    submit_ticket_report,
    update_ticket_status,
)

logging.basicConfig(level=logging.INFO)

app = FastAPI(
    title="CivicSignal Local & Hybrid Server",
    description="Dual-mode FastAPI server mirroring AWS Lambda + API Gateway",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ReportRequest(BaseModel):
    category: str
    description: str
    latitude: float
    longitude: float
    location_name: str = ""
    citizen_contact: str = ""
    image_data: Optional[str] = None


class StatusUpdateRequest(BaseModel):
    status: str


class ChatRequest(BaseModel):
    question: str


@app.get("/health")
def health():
    return get_health_status()


@app.get("/tickets")
def list_all_tickets():
    return get_all_tickets_payload()


@app.post("/tickets")
def create_ticket(req: ReportRequest):
    code, body = submit_ticket_report(req.model_dump())
    return JSONResponse(status_code=code, content=body)


@app.post("/tickets/seed")
def seed_tickets():
    return seed_demo_tickets()


@app.patch("/tickets/{ticket_id}/status")
@app.post("/tickets/{ticket_id}/status")
def patch_ticket_status(ticket_id: str, req: StatusUpdateRequest):
    code, body = update_ticket_status(ticket_id, req.status)
    if code >= 400:
        raise HTTPException(status_code=code, detail=body.get("error", "Status update failed"))
    return body


@app.post("/chat")
def civic_chat(req: ChatRequest):
    return handle_civic_chat(req.question)


FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
else:
    @app.get("/")
    def root_health():
        return get_health_status()
