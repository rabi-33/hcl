"""Dual-mode persistence & notification layer (Azure App Service, SMTP/Webhook & Local JSON)."""

import base64
from datetime import datetime, timezone
from decimal import Decimal
from email.message import EmailMessage
import json
import logging
import os
from pathlib import Path
import smtplib
from typing import Any, Dict, List, Optional
import uuid

import httpx

logger = logging.getLogger("civicsignal.storage")

BASE_DIR = Path(__file__).resolve().parent.parent


def _get_local_tickets_path() -> Path:
    return Path(os.getenv("LOCAL_TICKETS_PATH", str(BASE_DIR / "local_tickets.json")))


def _get_local_sns_path() -> Path:
    return Path(os.getenv("LOCAL_SNS_PATH", str(BASE_DIR / "local_sns_log.json")))


def _aws_region() -> str:
    return os.getenv("AWS_REGION", "ap-south-1").strip() or "ap-south-1"


def _dynamo_table_name() -> str:
    return os.getenv("DYNAMODB_TABLE", "").strip()


def _s3_bucket_name() -> str:
    return os.getenv("S3_BUCKET", "").strip()


def _sns_topic_arn() -> str:
    return os.getenv("SNS_TOPIC_ARN", "").strip()


def _webhook_url() -> str:
    return (os.getenv("AZURE_WEBHOOK_URL") or os.getenv("NOTIFICATION_WEBHOOK_URL") or "").strip()


def _smtp_config() -> Optional[Dict[str, Any]]:
    user = os.getenv("SMTP_USER", "").strip()
    password = os.getenv("SMTP_PASSWORD", "").strip()
    if not user or not password:
        return None
    return {
        "host": os.getenv("SMTP_HOST", "smtp.gmail.com").strip() or "smtp.gmail.com",
        "port": int(os.getenv("SMTP_PORT", "587")),
        "user": user,
        "password": password,
    }


def _to_dynamo_safe(obj: Any) -> Any:
    if isinstance(obj, float):
        return Decimal(str(obj))
    if isinstance(obj, dict):
        return {k: _to_dynamo_safe(v) for k, v in obj.items() if v is not None}
    if isinstance(obj, list):
        return [_to_dynamo_safe(v) for v in obj]
    return obj


def _from_dynamo_safe(obj: Any) -> Any:
    if isinstance(obj, Decimal):
        return int(obj) if obj % 1 == 0 else float(obj)
    if isinstance(obj, dict):
        return {k: _from_dynamo_safe(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_from_dynamo_safe(v) for v in obj]
    return obj


def get_cloud_capabilities() -> Dict[str, Any]:
    """Report active hosting, storage, photo, and notification backends."""
    has_dynamo = bool(_dynamo_table_name())
    has_s3 = bool(_s3_bucket_name())
    has_sns = bool(_sns_topic_arn())
    has_smtp = _smtp_config() is not None
    has_webhook = bool(_webhook_url())

    if has_smtp and has_webhook:
        notif_mode = "Azure Webhook + SMTP Email"
    elif has_smtp:
        notif_mode = "SMTP Citizen Email Alerts"
    elif has_webhook:
        notif_mode = "Azure Event Webhook"
    elif has_sns:
        notif_mode = "Amazon SNS"
    else:
        notif_mode = "Azure Notification Audit Log"

    return {
        "cloud_host": "Microsoft Azure App Service",
        "storage_mode": f"Amazon DynamoDB ({_dynamo_table_name()})" if has_dynamo else "Azure App Service JSON Store",
        "photo_mode": f"Amazon S3 ({_s3_bucket_name()})" if has_s3 else "Inline Base64 Photo Store",
        "notification_mode": notif_mode,
        # Backward-compatible keys
        "aws_region": _aws_region(),
        "dynamodb_mode": f"Amazon DynamoDB ({_dynamo_table_name()})" if has_dynamo else "Azure App Service JSON Store",
        "s3_mode": f"Amazon S3 ({_s3_bucket_name()})" if has_s3 else "Inline Base64 Photo Store",
        "sns_mode": notif_mode,
        "aws_configured": has_dynamo or has_s3 or has_sns,
        "smtp_configured": has_smtp,
        "webhook_configured": has_webhook,
    }


def _load_local_json(path: Path) -> List[Dict[str, Any]]:
    if not path.exists():
        return []
    try:
        raw = path.read_text(encoding="utf-8").strip()
        if not raw:
            return []
        data = json.loads(raw)
        return data if isinstance(data, list) else []
    except Exception as exc:
        logger.warning("Failed reading %s: %s", path, exc)
        return []


def _save_local_json(path: Path, records: List[Dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(records, indent=2), encoding="utf-8")


def store_issue_photo(ticket_id: str, image_data: Optional[str]) -> Optional[str]:
    """Upload base64 photo to S3 if configured, otherwise keep safe preview data URL."""
    if not image_data or not image_data.strip():
        return None

    bucket = _s3_bucket_name()
    if not bucket:
        return image_data.strip()

    try:
        import boto3

        raw = image_data.strip()
        mime = "image/jpeg"
        b64_payload = raw
        if raw.startswith("data:") and ";base64," in raw:
            header, b64_payload = raw.split(";base64,", 1)
            mime = header[5:] or "image/jpeg"

        ext = "png" if "png" in mime else "jpg"
        key = f"issues/{ticket_id}.{ext}"
        image_bytes = base64.b64decode(b64_payload)

        s3 = boto3.client("s3", region_name=_aws_region())
        s3.put_object(Bucket=bucket, Key=key, Body=image_bytes, ContentType=mime)
        return s3.generate_presigned_url("get_object", Params={"Bucket": bucket, "Key": key}, ExpiresIn=86400)
    except Exception as exc:
        logger.warning("S3 upload failed, using inline preview: %s", exc)
        return image_data.strip()


def list_tickets() -> List[Dict[str, Any]]:
    """Fetch all tickets sorted by highest Priority Score first."""
    table_name = _dynamo_table_name()
    if table_name:
        try:
            import boto3

            dynamo = boto3.resource("dynamodb", region_name=_aws_region())
            table = dynamo.Table(table_name)
            resp = table.scan()
            items = [_from_dynamo_safe(item) for item in resp.get("Items", [])]
            return sorted(items, key=lambda t: int(t.get("priority_score", 0)), reverse=True)
        except Exception as exc:
            logger.warning("DynamoDB scan failed, falling back to JSON store: %s", exc)

    items = _load_local_json(_get_local_tickets_path())
    return sorted(items, key=lambda t: int(t.get("priority_score", 0)), reverse=True)


def save_ticket(ticket: Dict[str, Any]) -> Dict[str, Any]:
    """Create or update a ticket in DynamoDB or Azure JSON store."""
    table_name = _dynamo_table_name()
    if table_name:
        try:
            import boto3

            dynamo = boto3.resource("dynamodb", region_name=_aws_region())
            table = dynamo.Table(table_name)
            table.put_item(Item=_to_dynamo_safe(ticket))
            return ticket
        except Exception as exc:
            logger.warning("DynamoDB put_item failed, falling back to JSON store: %s", exc)

    path = _get_local_tickets_path()
    tickets = _load_local_json(path)
    updated = False
    for idx, existing in enumerate(tickets):
        if existing.get("ticket_id") == ticket.get("ticket_id"):
            tickets[idx] = ticket
            updated = True
            break
    if not updated:
        tickets.append(ticket)
    _save_local_json(path, tickets)
    return ticket


def get_ticket_by_id(ticket_id: str) -> Optional[Dict[str, Any]]:
    for t in list_tickets():
        if t.get("ticket_id") == ticket_id:
            return t
    return None


def _send_smtp_email(recipient: str, subject: str, body: str) -> bool:
    cfg = _smtp_config()
    if not cfg or "@" not in recipient:
        return False
    try:
        msg = EmailMessage()
        msg["From"] = cfg["user"]
        msg["To"] = recipient
        msg["Subject"] = subject
        msg.set_content(body)
        with smtplib.SMTP(cfg["host"], cfg["port"], timeout=10) as server:
            server.starttls()
            server.login(cfg["user"], cfg["password"])
            server.send_message(msg)
        return True
    except Exception as exc:
        logger.warning("SMTP email delivery failed: %s", exc)
        return False


def publish_sns_alert(ticket: Dict[str, Any], new_status: str) -> Dict[str, Any]:
    """Dispatch citizen alert via SMTP Email, Azure Webhook, Amazon SNS, or Audit Log."""
    contact = str(ticket.get("citizen_contact") or "registered citizen").strip()
    subject = f"CivicSignal Update: {ticket.get('ticket_id')} -> {new_status}"
    message = (
        f"[CivicSignal Alert] Ticket {ticket.get('ticket_id')} ({ticket.get('category')} at "
        f"{ticket.get('location_name') or 'Tamil Nadu'}) is now {new_status}. "
        f"Assigned Dept: {ticket.get('department')}."
    )

    channels_used: List[str] = []
    message_id = f"az-alert-{uuid.uuid4().hex[:8]}"

    # 1. Direct SMTP Email when SMTP credentials & citizen email are present
    if _send_smtp_email(contact, subject, message):
        channels_used.append("SMTP Email")

    # 2. Azure Logic App / Event Grid / Teams Webhook when configured
    webhook = _webhook_url()
    if webhook:
        try:
            with httpx.Client(timeout=6.0) as client:
                resp = client.post(
                    webhook,
                    json={
                        "ticket_id": ticket.get("ticket_id"),
                        "status": new_status,
                        "category": ticket.get("category"),
                        "location_name": ticket.get("location_name"),
                        "department": ticket.get("department"),
                        "recipient": contact,
                        "message": message,
                    },
                )
                if resp.is_success:
                    channels_used.append("Azure Webhook")
        except Exception as exc:
            logger.warning("Webhook delivery failed: %s", exc)

    # 3. Optional Amazon SNS if explicitly configured
    topic_arn = _sns_topic_arn()
    if topic_arn:
        try:
            import boto3

            sns = boto3.client("sns", region_name=_aws_region())
            resp = sns.publish(TopicArn=topic_arn, Subject=subject, Message=message)
            channels_used.append("Amazon SNS")
            message_id = resp.get("MessageId", message_id)
        except Exception as exc:
            logger.warning("Amazon SNS publish failed: %s", exc)

    delivery_channel = " + ".join(channels_used) if channels_used else "Azure Audit Log"

    entry = {
        "alert_id": message_id,
        "ticket_id": ticket.get("ticket_id"),
        "status": new_status,
        "recipient": contact,
        "channel": delivery_channel,
        "message": message,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    sns_path = _get_local_sns_path()
    logs = _load_local_json(sns_path)
    logs.insert(0, entry)
    _save_local_json(sns_path, logs[:40])
    return entry


def list_sns_alerts() -> List[Dict[str, Any]]:
    return _load_local_json(_get_local_sns_path())
