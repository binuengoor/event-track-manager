"""Redaction of personal data (phone numbers, guardians) from public API responses."""
import json
import re
from typing import Any

PRIVATE_KEYS = frozenset({
    "contact_info",
    "guardian_name",
    "guardian_phone",
    "partner_phone",
    "signer_phone",
    "phone",
})


def strip_private(data: Any) -> Any:
    """Returns a deep copy of dicts/lists/pydantic models with all private keys removed."""
    if hasattr(data, "model_dump"):
        data = data.model_dump()
    if isinstance(data, dict):
        return {k: strip_private(v) for k, v in data.items() if k not in PRIVATE_KEYS}
    if isinstance(data, (list, tuple)):
        return [strip_private(v) for v in data]
    return data


# ---------------------------------------------------------------------------------- activity-log redaction
_PHONE_RE = re.compile(r"(?<![\w.])\+?\d(?:[\s().-]?\d){9,}(?!\w)")
PHONE_PLACEHOLDER = "[phone removed]"


def _is_phone_key(key: Any) -> bool:
    k = str(key).lower()
    return k == "contact_info" or "phone" in k


def _scrub(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: _scrub(v) for k, v in value.items() if not _is_phone_key(k)}
    if isinstance(value, (list, tuple)):
        return [_scrub(v) for v in value]
    if isinstance(value, str):
        return _PHONE_RE.sub(PHONE_PLACEHOLDER, value)
    return value


def redact_phones(text: str) -> str:
    """Removes phone numbers from an activity-log summary or details string at write time.

    JSON objects lose their phone-valued keys; any other digit run that looks like a phone number is replaced."""
    if not text:
        return text or ""
    try:
        parsed = json.loads(text)
    except (ValueError, TypeError):
        return _PHONE_RE.sub(PHONE_PLACEHOLDER, text)
    if isinstance(parsed, (dict, list)):
        return json.dumps(_scrub(parsed))
    return _PHONE_RE.sub(PHONE_PLACEHOLDER, text)
