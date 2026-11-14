"""Shared CivicSignal business logic consumed by both AWS Lambda and FastAPI."""

from datetime import datetime, timezone
import logging
from typing import Any, Dict, List, Tuple
import uuid

from core.storage import (
    get_cloud_capabilities,
    get_ticket_by_id,
    list_sns_alerts,
    list_tickets,
    publish_sns_alert,
    save_ticket,
    store_issue_photo,
)
from core.triage import (
    analyze_issue_with_ai,
    answer_civic_question,
    compute_priority_band,
    find_nearby_duplicate,
    get_gemini_key,
    get_gemini_model,
)

logger = logging.getLogger("civicsignal.service")

VALID_STATUSES = {"OPEN", "IN_PROGRESS", "RESOLVED"}


def get_health_status() -> Dict[str, Any]:
    key_set = bool(get_gemini_key())
    return {
        "status": "healthy",
        "service": "CivicSignal Cloud Triage API",
        "active_ai_engine": f"Gemini Vision Primary ({get_gemini_model()})" if key_set else "Local Rule Fallback",
        "gemini_configured": key_set,
        "cloud": get_cloud_capabilities(),
        "version": "1.0.0",
    }


def get_all_tickets_payload() -> Dict[str, Any]:
    tickets = list_tickets()
    alerts = list_sns_alerts()
    return {
        "tickets": tickets,
        "total": len(tickets),
        "critical_count": sum(1 for t in tickets if t.get("priority_band") == "CRITICAL"),
        "sns_alerts": alerts[:15],
    }


def submit_ticket_report(payload: Dict[str, Any]) -> Tuple[int, Dict[str, Any]]:
    """Triage incoming report with AI + 150m Geo-Duplicate Merger."""
    category = str(payload.get("category") or "").strip()
    description = str(payload.get("description") or "").strip()
    location_name = str(payload.get("location_name") or "").strip()
    citizen_contact = str(payload.get("citizen_contact") or "").strip()
    image_data = payload.get("image_data")

    try:
        latitude = float(payload["latitude"])
        longitude = float(payload["longitude"])
    except (KeyError, TypeError, ValueError):
        return 400, {"error": "Valid numeric latitude and longitude are required."}

    if not category or not description:
        return 400, {"error": "Category and description are required."}

    ai_result = analyze_issue_with_ai(
        category=category,
        description=description,
        location_name=location_name,
        image_data=image_data,
    )

    if not ai_result.get("is_authentic", True):
        return 422, {
            "rejected": True,
            "reason": ai_result.get("rejection_reason") or "Uploaded photo failed civic authenticity verification.",
            "engine_used": ai_result.get("engine_used"),
        }

    existing_tickets = list_tickets()
    duplicate = find_nearby_duplicate(
        existing_tickets=existing_tickets,
        category=category,
        latitude=latitude,
        longitude=longitude,
        radius_m=150.0,
    )

    now_iso = datetime.now(timezone.utc).isoformat()

    if duplicate is not None:
        new_dup_count = int(duplicate.get("duplicate_count", 1)) + 1
        new_score = min(100, int(duplicate.get("priority_score", 50)) + 10)
        duplicate["duplicate_count"] = new_dup_count
        duplicate["priority_score"] = new_score
        duplicate["priority_band"] = compute_priority_band(new_score)
        duplicate["updated_at"] = now_iso
        if description and description not in duplicate.get("description", ""):
            duplicate["description"] = f"{duplicate.get('description', '')} | +Report: {description}"
        save_ticket(duplicate)
        logger.info(
            "Merged duplicate report into %s (count=%d, score=%d)",
            duplicate["ticket_id"],
            new_dup_count,
            new_score,
        )
        return 200, {
            "merged": True,
            "message": f"Merged into existing hotspot ticket {duplicate['ticket_id']} (+10 Priority Boost).",
            "ticket": duplicate,
            "engine_used": ai_result.get("engine_used"),
        }

    ticket_id = f"CS-{uuid.uuid4().hex[:6].upper()}"
    photo_ref = store_issue_photo(ticket_id, image_data)
    score = int(ai_result["severity_score"])

    new_ticket = {
        "ticket_id": ticket_id,
        "category": category,
        "description": description,
        "location_name": location_name or f"{latitude:.4f}, {longitude:.4f}",
        "latitude": latitude,
        "longitude": longitude,
        "citizen_contact": citizen_contact or "anonymous@civicsignal.in",
        "photo_url": photo_ref,
        "status": "OPEN",
        "duplicate_count": 1,
        "priority_score": score,
        "priority_band": compute_priority_band(score),
        "department": ai_result["department"],
        "ai_reasoning": ai_result["ai_reasoning"],
        "engine_used": ai_result["engine_used"],
        "created_at": now_iso,
        "updated_at": now_iso,
    }
    save_ticket(new_ticket)
    logger.info("Created ticket %s (score=%d, dept=%s)", ticket_id, score, new_ticket["department"])
    return 201, {
        "merged": False,
        "message": f"Created ticket {ticket_id} and routed to {new_ticket['department']}.",
        "ticket": new_ticket,
        "engine_used": ai_result["engine_used"],
    }


def update_ticket_status(ticket_id: str, new_status: str) -> Tuple[int, Dict[str, Any]]:
    clean_status = (new_status or "").strip().upper()
    if clean_status not in VALID_STATUSES:
        return 400, {"error": f"Invalid status '{new_status}'. Expected OPEN, IN_PROGRESS, or RESOLVED."}

    ticket = get_ticket_by_id(ticket_id)
    if not ticket:
        return 404, {"error": f"Ticket '{ticket_id}' not found."}

    ticket["status"] = clean_status
    ticket["updated_at"] = datetime.now(timezone.utc).isoformat()
    save_ticket(ticket)
    sns_alert = publish_sns_alert(ticket, clean_status)

    return 200, {
        "ticket": ticket,
        "sns_alert": sns_alert,
    }


def seed_demo_tickets() -> Dict[str, Any]:
    """Populate realistic Chennai demo issues if database is currently empty."""
    existing = list_tickets()
    if existing:
        return {"seeded": False, "message": "Tickets already exist.", "tickets": existing}

    samples = [
        {
            "category": "Pothole",
            "description": "Deep water-filled pothole on main road right outside school gate causing two-wheeler skids.",
            "location_name": "Vel Tech Avadi Rd",
            "latitude": 13.1770,
            "longitude": 80.0970,
            "citizen_contact": "citizen1@veltech.edu.in",
        },
        {
            "category": "Damaged Streetlight",
            "description": "Exposed live wire hanging from broken streetlight pole near T. Nagar Bus Stand.",
            "location_name": "T. Nagar Bus Stand",
            "latitude": 13.0418,
            "longitude": 80.2341,
            "citizen_contact": "+91-9840011223",
        },
        {
            "category": "Water Leakage",
            "description": "Main pipeline burst causing severe flooding near hospital entrance in Anna Nagar.",
            "location_name": "Anna Nagar Main Rd",
            "latitude": 13.0850,
            "longitude": 80.2101,
            "citizen_contact": "resident@annanagar.in",
        },
    ]

    created: List[Dict[str, Any]] = []
    for sample in samples:
        _code, res = submit_ticket_report(sample)
        if "ticket" in res:
            created.append(res["ticket"])

    return {"seeded": True, "count": len(created), "tickets": list_tickets()}


def handle_civic_chat(question: str) -> Dict[str, Any]:
    tickets = list_tickets()
    return answer_civic_question(question, tickets)
