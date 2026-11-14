"""AWS Lambda entrypoint for CivicSignal (API Gateway REST v1 & HTTP v2)."""

import json
import logging
import os
import re
from typing import Any, Dict

from core.service import (
    get_all_tickets_payload,
    get_health_status,
    handle_civic_chat,
    seed_demo_tickets,
    submit_ticket_report,
    update_ticket_status,
)

# Structured CloudWatch logging
logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format='{"time":"%(asctime)s","level":"%(levelname)s","logger":"%(name)s","msg":"%(message)s"}',
)
logger = logging.getLogger("civicsignal.lambda")

CORS_HEADERS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
}


def _response(status_code: int, body: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "statusCode": status_code,
        "headers": CORS_HEADERS,
        "body": json.dumps(body),
    }


def _extract_method_and_path(event: Dict[str, Any]) -> tuple[str, str]:
    req_ctx = event.get("requestContext") or {}
    http_info = req_ctx.get("http") or {}
    method = (event.get("httpMethod") or http_info.get("method") or "GET").upper()
    raw_path = event.get("rawPath") or event.get("path") or "/"
    # Strip API Gateway stage prefix if present (e.g., /prod/tickets -> /tickets)
    stage = req_ctx.get("stage")
    if stage and stage != "$default" and raw_path.startswith(f"/{stage}/"):
        raw_path = raw_path[len(stage) + 1 :]
    return method, raw_path.rstrip("/") or "/"


def _parse_body(event: Dict[str, Any]) -> Dict[str, Any]:
    raw_body = event.get("body")
    if not raw_body:
        return {}
    if isinstance(raw_body, dict):
        return raw_body
    return json.loads(raw_body)


def lambda_handler(event: Dict[str, Any], _context: Any = None) -> Dict[str, Any]:
    """Handle API Gateway HTTP requests for CivicSignal."""
    method, path = _extract_method_and_path(event)
    logger.info("Incoming Lambda request: %s %s", method, path)

    if method == "OPTIONS":
        return _response(200, {"ok": True})

    try:
        if method == "GET" and path in ("/", "/health"):
            return _response(200, get_health_status())

        if method == "GET" and path == "/tickets":
            return _response(200, get_all_tickets_payload())

        if method == "POST" and path == "/tickets":
            code, body = submit_ticket_report(_parse_body(event))
            return _response(code, body)

        if method == "POST" and path == "/tickets/seed":
            return _response(200, seed_demo_tickets())

        status_match = re.match(r"^/tickets/([^/]+)/status$", path)
        if method in ("PATCH", "POST") and status_match:
            ticket_id = status_match.group(1)
            payload = _parse_body(event)
            code, body = update_ticket_status(ticket_id, str(payload.get("status", "")))
            return _response(code, body)

        if method == "POST" and path == "/chat":
            payload = _parse_body(event)
            return _response(200, handle_civic_chat(str(payload.get("question", ""))))

        return _response(404, {"error": f"Route not found: {method} {path}"})
    except Exception as exc:
        logger.exception("Unhandled Lambda exception")
        return _response(500, {"error": str(exc)})
