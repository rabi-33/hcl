"""CivicSignal AI Triage, Geo-Cluster Duplicate Merger & Local Rule Fallback."""

import json
import logging
import math
import os
import re
from typing import Any, Dict, List, Optional, Tuple

import httpx

logger = logging.getLogger("civicsignal.triage")

GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models"
DEFAULT_GEMINI_MODEL = "gemini-2.5-flash"

CATEGORY_META: Dict[str, Tuple[int, str]] = {
    "pothole": (52, "Highways / Roads"),
    "garbage accumulation": (44, "Sanitation"),
    "damaged streetlight": (48, "Electrical"),
    "water leakage": (50, "Metro Water"),
}

URGENCY_KEYWORDS: Dict[str, int] = {
    "live wire": 32,
    "electrocution": 32,
    "spark": 25,
    "accident": 24,
    "flooding": 22,
    "hospital": 20,
    "school": 20,
    "ambulance": 20,
    "main road": 16,
    "highway": 16,
    "bus stand": 14,
    "collapse": 22,
    "sewage": 15,
    "overflow": 14,
    "dark": 10,
    "children": 14,
    "elderly": 12,
    "deep": 10,
    "burst": 18,
}


def get_gemini_key() -> str:
    return os.getenv("GEMINI_API_KEY", "").strip()


def get_gemini_model() -> str:
    return os.getenv("GEMINI_MODEL", DEFAULT_GEMINI_MODEL).strip() or DEFAULT_GEMINI_MODEL


def haversine_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate great-circle distance between two GPS coordinates in meters."""
    earth_radius_m = 6_371_000.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lon2 - lon1)

    a = (
        math.sin(d_phi / 2.0) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2.0) ** 2
    )
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return earth_radius_m * c


def find_nearby_duplicate(
    existing_tickets: List[Dict[str, Any]],
    category: str,
    latitude: float,
    longitude: float,
    radius_m: float = 150.0,
) -> Optional[Dict[str, Any]]:
    """Find an existing OPEN ticket of the same category within 150 meters."""
    target_cat = (category or "").strip().lower()
    closest_ticket: Optional[Dict[str, Any]] = None
    closest_dist = float("inf")

    for ticket in existing_tickets:
        if (ticket.get("status") or "OPEN").upper() != "OPEN":
            continue
        if (ticket.get("category") or "").strip().lower() != target_cat:
            continue
        t_lat = ticket.get("latitude")
        t_lon = ticket.get("longitude")
        if t_lat is None or t_lon is None:
            continue

        dist = haversine_meters(latitude, longitude, float(t_lat), float(t_lon))
        if dist <= radius_m and dist < closest_dist:
            closest_dist = dist
            closest_ticket = ticket

    return closest_ticket


def compute_priority_band(score: int) -> str:
    if score >= 80:
        return "CRITICAL"
    if score >= 50:
        return "HIGH"
    return "MODERATE"


def _parse_data_url_image(image_data: Optional[str]) -> Optional[Tuple[str, str]]:
    """Extract (mime_type, raw_base64) from a data URL or base64 payload."""
    if not image_data or not image_data.strip():
        return None
    raw = image_data.strip()
    if raw.startswith("data:") and ";base64," in raw:
        header, b64 = raw.split(";base64,", 1)
        mime = header[5:] or "image/jpeg"
        return mime, b64.strip()
    return "image/jpeg", raw


def score_issue_locally(
    category: str,
    description: str,
    location_name: str = "",
    upvotes: int = 1,
    has_image: bool = False,
) -> Dict[str, Any]:
    """Deterministic Python rule-based fallback for severity & department triage."""
    cat_key = (category or "").strip().lower()
    base_score, department = CATEGORY_META.get(cat_key, (45, "Municipal Operations"))

    combined_text = f"{description} {location_name}".lower()
    matched_keywords: List[str] = []
    keyword_boost = 0

    for kw, weight in URGENCY_KEYWORDS.items():
        if kw in combined_text:
            matched_keywords.append(kw)
            keyword_boost += weight

    keyword_boost = min(40, keyword_boost)
    upvote_boost = min(15, max(0, upvotes - 1) * 5)
    photo_boost = 4 if has_image else 0

    score = max(1, min(100, base_score + keyword_boost + upvote_boost + photo_boost))

    if matched_keywords:
        reason = (
            f"Local Rule Triage assigned {score}/100 ({compute_priority_band(score)}) "
            f"due to high-risk keywords: {', '.join(matched_keywords[:4])}."
        )
    else:
        reason = (
            f"Local Rule Triage assigned {score}/100 ({compute_priority_band(score)}) "
            f"based on {category} baseline priority for {department}."
        )

    return {
        "is_authentic": True,
        "rejection_reason": None,
        "severity_score": score,
        "department": department,
        "ai_reasoning": reason,
        "engine_used": "Local Rule Fallback",
    }


def _call_gemini_sync(
    parts: List[Dict[str, Any]],
    expect_json: bool = False,
    max_tokens: int = 700,
) -> str:
    """Synchronous HTTPS call to Gemini API (safe inside both AWS Lambda and FastAPI)."""
    api_key = get_gemini_key()
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY not configured")

    model = get_gemini_model()
    endpoint = f"{GEMINI_API_BASE}/{model}:generateContent"

    body: Dict[str, Any] = {
        "contents": [{"parts": parts}],
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": max_tokens,
            "thinkingConfig": {"thinkingBudget": 0},
        },
    }
    if expect_json:
        body["generationConfig"]["responseMimeType"] = "application/json"

    with httpx.Client(timeout=14.0) as client:
        resp = client.post(endpoint, params={"key": api_key}, json=body)
        if resp.status_code == 429:
            raise RuntimeError("Gemini rate-limited (429)")
        resp.raise_for_status()
        data = resp.json()

    candidates = data.get("candidates") or []
    if not candidates:
        raise RuntimeError("Gemini returned no candidates")
    out_parts = candidates[0].get("content", {}).get("parts") or []
    text = "".join(p.get("text", "") for p in out_parts).strip()
    if not text:
        raise RuntimeError("Gemini returned empty text")
    return text


def _strip_json_fences(raw_text: str) -> str:
    cleaned = raw_text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:].strip()
    return cleaned


def analyze_issue_with_ai(
    category: str,
    description: str,
    location_name: str = "",
    image_data: Optional[str] = None,
    upvotes: int = 1,
) -> Dict[str, Any]:
    """Verify photo authenticity and score severity via Gemini Vision, falling back locally."""
    parsed_img = _parse_data_url_image(image_data)
    baseline = score_issue_locally(
        category=category,
        description=description,
        location_name=location_name,
        upvotes=upvotes,
        has_image=parsed_img is not None,
    )

    if not get_gemini_key():
        return baseline

    prompt_text = (
        "You are CivicSignal, a smart municipal public-issue triage AI.\n"
        "Analyze the citizen report and attached photo (if present) and return ONLY valid JSON with:\n"
        '  "is_authentic": boolean (set false ONLY if the image is clearly a human selfie, meme, blank/solid screen, or completely unrelated indoor spam; if no image is attached or image matches a street/civic issue, set true),\n'
        '  "rejection_reason": string or null (short reason if is_authentic is false, else null),\n'
        '  "severity_score": integer 1 to 100 based on public safety risk (near school/hospital/live wire/flooding/main road = 80-100),\n'
        '  "department": one of ["Highways / Roads", "Sanitation", "Electrical", "Metro Water", "Municipal Operations"],\n'
        '  "ai_reasoning": 1 concise sentence explaining the severity score and recommended action.\n\n'
        f"Category: {category}\n"
        f"Location: {location_name or 'Not specified'}\n"
        f"Description: {description}\n"
    )

    parts: List[Dict[str, Any]] = [{"text": prompt_text}]
    if parsed_img is not None:
        mime_type, b64_data = parsed_img
        parts.append({"inlineData": {"mimeType": mime_type, "data": b64_data}})

    try:
        raw_json = _call_gemini_sync(parts, expect_json=True, max_tokens=500)
        parsed = json.loads(_strip_json_fences(raw_json))

        is_authentic = bool(parsed.get("is_authentic", True))
        rejection_reason = parsed.get("rejection_reason")
        severity = int(parsed.get("severity_score", baseline["severity_score"]))
        severity = max(1, min(100, severity))
        department = str(parsed.get("department") or baseline["department"]).strip()
        reasoning = str(parsed.get("ai_reasoning") or baseline["ai_reasoning"]).strip()

        return {
            "is_authentic": is_authentic,
            "rejection_reason": str(rejection_reason) if rejection_reason else None,
            "severity_score": severity,
            "department": department,
            "ai_reasoning": reasoning,
            "engine_used": f"Gemini Vision Primary ({get_gemini_model()})",
        }
    except Exception as exc:
        logger.warning("Gemini triage fallback triggered: %s", exc)
        baseline["engine_used"] = f"Local Rule Fallback ({type(exc).__name__})"
        return baseline


def _answer_locally_from_tickets(question: str, tickets: List[Dict[str, Any]]) -> str:
    """Deterministic grounded Q&A strictly from live tickets when offline."""
    if not tickets:
        return "There are currently no reported civic tickets in the system. Submit an issue in Tab 1 to begin triage."

    q_low = (question or "").lower()
    ordered = sorted(tickets, key=lambda t: int(t.get("priority_score", 0)), reverse=True)
    unresolved = [t for t in ordered if (t.get("status") or "OPEN").upper() != "RESOLVED"]

    if any(k in q_low for k in ("work-order", "work order", "notice", "draft", "pothole")):
        potholes = [t for t in unresolved if "pothole" in (t.get("category") or "").lower()]
        target = potholes[0] if potholes else (unresolved[0] if unresolved else ordered[0])
        return (
            f"URGENT WORK ORDER [{target.get('ticket_id')}]: Dispatch {target.get('department')} crew to "
            f"{target.get('location_name') or 'reported GPS'} immediately. "
            f"Category: {target.get('category')} | Priority: {target.get('priority_score')}/100 "
            f"({target.get('duplicate_count', 1)} citizen report(s)). Notes: {target.get('description')}"
        )

    if any(k in q_low for k in ("ward", "area", "most", "where", "hotspot", "critical")):
        pool = unresolved if unresolved else ordered
        area_scores: Dict[str, int] = {}
        area_counts: Dict[str, int] = {}
        for t in pool:
            loc = t.get("location_name") or "Unknown Area"
            area_scores[loc] = area_scores.get(loc, 0) + int(t.get("priority_score", 0))
            area_counts[loc] = area_counts.get(loc, 0) + int(t.get("duplicate_count", 1))
        top_area = max(area_scores, key=lambda k: area_scores[k])
        top_ticket = pool[0]
        return (
            f"{top_area} currently has the highest unresolved severity load ({area_counts[top_area]} report(s)). "
            f"Top ticket is {top_ticket.get('ticket_id')} ({top_ticket.get('category')}, "
            f"Priority {top_ticket.get('priority_score')}/100) assigned to {top_ticket.get('department')}."
        )

    top3 = (unresolved or ordered)[:3]
    summary_parts = [
        f"{t.get('ticket_id')}: {t.get('category')} at {t.get('location_name') or 'GPS'} "
        f"(Priority {t.get('priority_score')}/100, {t.get('status')}, {t.get('duplicate_count', 1)} report(s))"
        for t in top3
    ]
    return "Top priority summary: " + " | ".join(summary_parts) + "."


def answer_civic_question(question: str, tickets: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Answer citizen/admin Q&A grounded in live tickets using Gemini or local fallback."""
    clean_q = (question or "").strip()
    if not clean_q:
        return {
            "answer": "Ask a question about active civic tickets, critical wards, or dispatch priorities.",
            "engine_used": "Local Rule Fallback",
        }

    if not get_gemini_key():
        return {
            "answer": _answer_locally_from_tickets(clean_q, tickets),
            "engine_used": "Local Rule Fallback",
        }

    ordered = sorted(tickets, key=lambda t: int(t.get("priority_score", 0)), reverse=True)[:25]
    compact_tickets = [
        {
            "ticket_id": t.get("ticket_id"),
            "category": t.get("category"),
            "location": t.get("location_name"),
            "status": t.get("status"),
            "priority_score": t.get("priority_score"),
            "priority_band": t.get("priority_band"),
            "duplicate_count": t.get("duplicate_count", 1),
            "department": t.get("department"),
            "description": str(t.get("description", ""))[:180],
        }
        for t in ordered
    ]

    prompt = (
        "You are CivicSignal AI Co-Pilot for municipal admins and citizens.\n"
        "Answer the user's question concisely in 2 to 4 sentences using ONLY the live ticket JSON below.\n"
        "If asked to draft a work-order notice or dispatch summary, cite exact ticket IDs, locations, and priority scores.\n\n"
        f"LIVE TICKETS:\n{json.dumps(compact_tickets, indent=2)}\n\n"
        f"QUESTION: {clean_q}"
    )

    try:
        answer = _call_gemini_sync([{"text": prompt}], expect_json=False, max_tokens=500)
        return {
            "answer": answer,
            "engine_used": f"Gemini Primary ({get_gemini_model()})",
        }
    except Exception as exc:
        logger.warning("Gemini chat fallback triggered: %s", exc)
        return {
            "answer": _answer_locally_from_tickets(clean_q, tickets),
            "engine_used": f"Local Rule Fallback ({type(exc).__name__})",
        }
