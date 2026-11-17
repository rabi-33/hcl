"""FastAPI local server running the exact same core logic as AWS Lambda."""

import logging
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass

from core.auth import authenticate_admin, verify_admin_token
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


class AdminLoginRequest(BaseModel):
    username: str
    password: str


def _require_admin(authorization: Optional[str]) -> dict:
    session = verify_admin_token(authorization)
    if not session:
        raise HTTPException(status_code=401, detail="Admin authentication required.")
    return session


@app.post("/admin/login")
def admin_login(req: AdminLoginRequest):
    session = authenticate_admin(req.username, req.password)
    if not session:
        raise HTTPException(status_code=401, detail="Invalid municipal username or password.")
    return session


@app.get("/admin/me")
def admin_me(authorization: Optional[str] = Header(default=None)):
    session = _require_admin(authorization)
    return {"authenticated": True, "username": session.get("sub"), "role": session.get("role")}


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
def seed_tickets(authorization: Optional[str] = Header(default=None)):
    _require_admin(authorization)
    return seed_demo_tickets()


@app.patch("/tickets/{ticket_id}/status")
@app.post("/tickets/{ticket_id}/status")
def patch_ticket_status(
    ticket_id: str,
    req: StatusUpdateRequest,
    authorization: Optional[str] = Header(default=None),
):
    _require_admin(authorization)
    code, body = update_ticket_status(ticket_id, req.status)
    if code >= 400:
        raise HTTPException(status_code=code, detail=body.get("error", "Status update failed"))
    return body


@app.post("/chat")
def civic_chat(req: ChatRequest):
    return handle_civic_chat(req.question)


FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
if FRONTEND_DIR.exists():
    @app.get("/admin")
    def serve_admin():
        return FileResponse(str(FRONTEND_DIR / "admin.html"))

    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
else:
    @app.get("/")
    def root_health():
        return get_health_status()
