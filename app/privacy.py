"""Redaction of personal data (phone numbers, guardians) from public API responses."""
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
