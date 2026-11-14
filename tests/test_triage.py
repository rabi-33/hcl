"""Automated pytest suite for CivicSignal triage, 150m geo-merge, Lambda & fallback."""

import json
from pathlib import Path
import sys

from fastapi.testclient import TestClient
import pytest

BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from core import triage  # noqa: E402
import lambda_function  # noqa: E402
import local_server  # noqa: E402


@pytest.fixture(autouse=True)
def isolated_env(monkeypatch, tmp_path):
    """Isolate Gemini key and local JSON storage paths for every test."""
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("DYNAMODB_TABLE", raising=False)
    monkeypatch.delenv("S3_BUCKET", raising=False)
    monkeypatch.delenv("SNS_TOPIC_ARN", raising=False)
    monkeypatch.setenv("LOCAL_TICKETS_PATH", str(tmp_path / "tickets.json"))
    monkeypatch.setenv("LOCAL_SNS_PATH", str(tmp_path / "sns.json"))


client = TestClient(local_server.app)


def test_local_fallback_priority_calculation_and_keywords():
    """Urgency keywords ('school', 'live wire', 'flooding') boost priority deterministically."""
    low = triage.score_issue_locally("Garbage Accumulation", "Trash pile on side street")
    high = triage.score_issue_locally(
        "Damaged Streetlight",
        "Exposed live wire sparking outside school and hospital causing flooding risk",
    )

    assert low["engine_used"] == "Local Rule Fallback"
    assert low["department"] == "Sanitation"
    assert high["department"] == "Electrical"
    assert high["severity_score"] > low["severity_score"]
    assert high["severity_score"] >= 80


def test_haversine_150m_duplicate_merging_and_priority_boost():
    """Reports within 150m with matching category & OPEN status merge and boost priority +10."""
    first_res = client.post(
        "/tickets",
        json={
            "category": "Pothole",
            "description": "Deep pothole near Vel Tech gate",
            "location_name": "Vel Tech Avadi Rd",
            "latitude": 13.1770,
            "longitude": 80.0970,
        },
    )
    assert first_res.status_code == 201
    first_data = first_res.json()
    assert first_data["merged"] is False
    base_score = first_data["ticket"]["priority_score"]
    ticket_id = first_data["ticket"]["ticket_id"]

    # ~45 meters away, same category -> must merge
    dup_res = client.post(
        "/tickets",
        json={
            "category": "Pothole",
            "description": "Second rider slipped in same pothole",
            "location_name": "Vel Tech Avadi Rd",
            "latitude": 13.1773,
            "longitude": 80.0972,
        },
    )
    assert dup_res.status_code == 200
    dup_data = dup_res.json()
    assert dup_data["merged"] is True
    assert dup_data["ticket"]["ticket_id"] == ticket_id
    assert dup_data["ticket"]["duplicate_count"] == 2
    assert dup_data["ticket"]["priority_score"] == min(100, base_score + 10)

    # >500 meters away -> must NOT merge
    far_res = client.post(
        "/tickets",
        json={
            "category": "Pothole",
            "description": "Separate pothole far away",
            "location_name": "Avadi Market",
            "latitude": 13.1850,
            "longitude": 80.1050,
        },
    )
    assert far_res.status_code == 201
    assert far_res.json()["merged"] is False
    assert far_res.json()["ticket"]["ticket_id"] != ticket_id


def test_resolved_tickets_are_not_merged():
    """Once an issue is marked RESOLVED, a new report at the same GPS opens a fresh ticket."""
    r1 = client.post(
        "/tickets",
        json={
            "category": "Water Leakage",
            "description": "Pipe leak on Anna Nagar Main Rd",
            "location_name": "Anna Nagar Main Rd",
            "latitude": 13.0850,
            "longitude": 80.2101,
        },
    )
    tid = r1.json()["ticket"]["ticket_id"]

    status_res = client.patch(f"/tickets/{tid}/status", json={"status": "RESOLVED"})
    assert status_res.status_code == 200
    assert status_res.json()["ticket"]["status"] == "RESOLVED"
    assert status_res.json()["sns_alert"]["ticket_id"] == tid

    r2 = client.post(
        "/tickets",
        json={
            "category": "Water Leakage",
            "description": "Leak reappeared at exact spot",
            "location_name": "Anna Nagar Main Rd",
            "latitude": 13.0850,
            "longitude": 80.2101,
        },
    )
    assert r2.status_code == 201
    assert r2.json()["merged"] is False
    assert r2.json()["ticket"]["ticket_id"] != tid


def test_gemini_vision_authenticity_rejection_and_rate_limit_fallback(monkeypatch):
    """Gemini Vision rejects selfies/memes (422) and falls back cleanly when API fails."""
    monkeypatch.setenv("GEMINI_API_KEY", "fake-key")

    def fake_selfie_reject(_parts, expect_json=False, max_tokens=700):
        return json.dumps(
            {
                "is_authentic": False,
                "rejection_reason": "Image appears to be an indoor selfie, not a public street issue.",
                "severity_score": 10,
                "department": "Highways / Roads",
                "ai_reasoning": "Rejected spam upload.",
            }
        )

    monkeypatch.setattr(triage, "_call_gemini_sync", fake_selfie_reject)
    reject_res = client.post(
        "/tickets",
        json={
            "category": "Pothole",
            "description": "Road issue",
            "latitude": 13.0418,
            "longitude": 80.2341,
            "image_data": "data:image/jpeg;base64,/9j/4AAQSkZJRg==",
        },
    )
    assert reject_res.status_code == 422
    assert reject_res.json()["rejected"] is True

    # Simulate Gemini 429 rate-limit -> automatic Local Rule Fallback
    def fake_rate_limit(_parts, expect_json=False, max_tokens=700):
        raise RuntimeError("Gemini rate-limited (429)")

    monkeypatch.setattr(triage, "_call_gemini_sync", fake_rate_limit)
    fb_res = client.post(
        "/tickets",
        json={
            "category": "Pothole",
            "description": "Large pothole near school gate",
            "location_name": "Anna Nagar Main Rd",
            "latitude": 13.0850,
            "longitude": 80.2101,
        },
    )
    assert fb_res.status_code == 201
    assert fb_res.json()["engine_used"].startswith("Local Rule Fallback")


def test_lambda_handler_and_civic_chat():
    """AWS Lambda handler supports /health, /tickets/seed, /tickets, and /chat."""
    health_evt = {"httpMethod": "GET", "path": "/health"}
    h_resp = lambda_function.lambda_handler(health_evt)
    assert h_resp["statusCode"] == 200
    assert json.loads(h_resp["body"])["service"] == "CivicSignal Cloud Triage API"

    seed_resp = lambda_function.lambda_handler({"httpMethod": "POST", "path": "/tickets/seed"})
    assert seed_resp["statusCode"] == 200
    assert json.loads(seed_resp["body"])["seeded"] is True

    chat_resp = lambda_function.lambda_handler(
        {
            "httpMethod": "POST",
            "path": "/chat",
            "body": json.dumps({"question": "Which area has the most critical issues?"}),
        }
    )
    assert chat_resp["statusCode"] == 200
    chat_body = json.loads(chat_resp["body"])
    assert chat_body["engine_used"] == "Local Rule Fallback"
    assert "CS-" in chat_body["answer"]
