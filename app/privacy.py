"""Redaction of personal data (phone numbers, guardians) from public API responses."""
import json
import re
from typing import Any, Dict, Iterable, Optional

PRIVATE_KEYS = frozenset({
    "contact_info",
    "guardian_name",
    "guardian_phone",
    "partner_phone",
    "partner_guardian_name",
    "partner_guardian_phone",
    "signup_id",
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


# ---------------------------------------------------------------------------------- public name shortening
_PARTNER_SPLIT_RE = re.compile(r"\s*(?:&|,|\band\b)\s*", re.IGNORECASE)


def public_name(name: str, age_group: Optional[str], adult_opt_in: bool = False, shorten_juniors: bool = True) -> str:
    """Public display name. Juniors become 'First L.' when shortening is on; adults only when they opted in."""
    clean = (name or "").strip()
    if not clean:
        return name or ""
    is_junior = (age_group or "").strip().lower() == "junior"
    if not ((is_junior and shorten_juniors) or adult_opt_in):
        return clean
    parts = clean.split()
    if len(parts) < 2:
        return clean
    initial = parts[-1][0].upper()
    return f"{parts[0]} {initial}."


def shorten_juniors_enabled() -> bool:
    from app.config import get_setting
    value = get_setting("shorten_junior_names", True)
    if isinstance(value, str):
        return value.strip().lower() != "false"
    return bool(value)


class NamePrivacy:
    """Resolves public display names for a whole roster in one pass (name -> age group lookup)."""

    def __init__(self, performances: Iterable[Dict[str, Any]], enabled: Optional[bool] = None):
        self.enabled = shorten_juniors_enabled() if enabled is None else enabled
        self._junior: set = set()
        self._opted_in: set = set()   # adults who chose "show only my first name"; honoured even if the junior switch is off
        self._roster = {}
        for p in performances:
            for value in [p.get("performer_name"), *_PARTNER_SPLIT_RE.split(p.get("partner_name") or "")]:
                if value and value.strip():
                    clean = value.strip()
                    self._roster.setdefault(clean.casefold(), clean)
            if p.get("public_first_name_only") and p.get("performer_name"):
                self._opted_in.add(p["performer_name"].strip().lower())
            if (p.get("age_group") or "").strip().lower() == "junior" and p.get("performer_name"):
                self._junior.add(p["performer_name"].strip().lower())
            if (p.get("partner_age_group") or "").strip().lower() == "junior" and p.get("partner_name"):
                for n in _PARTNER_SPLIT_RE.split(p["partner_name"]):
                    if n.strip():
                        self._junior.add(n.strip().lower())

    def name(self, value: Optional[str]) -> Optional[str]:
        if not value:
            return value
        key = value.strip().lower()
        if not self.enabled and key not in self._opted_in:
            return value
        return public_name(value, "Junior" if key in self._junior else None,
                           adult_opt_in=key in self._opted_in, shorten_juniors=self.enabled)

    @property
    def active(self) -> bool:
        return self.enabled or bool(self._opted_in)

    def resolve_name(self, value: str) -> str:
        """Resolve a display name only when it identifies a single person.

        Full names remain valid for existing clients; ambiguous shortened names
        must never silently select another participant.
        """
        clean = value.strip()
        exact = self._roster.get(clean.casefold())
        matches = [name for name in self._roster.values() if (self.name(name) or "").casefold() == clean.casefold()]
        candidates = {name.casefold() for name in matches}
        if exact:
            candidates.add(exact.casefold())
        if len(candidates) > 1:
            raise ValueError("That display name matches more than one person. Please contact an organizer.")
        return exact or (matches[0] if matches else clean)

    def food_items(self, items: Iterable[Dict[str, Any]]) -> list:
        """Remove private fields and shorten names on public food listings."""
        return [
            {**item, "signer_name": self.partners(item.get("signer_name"))}
            if item.get("signer_name") else item
            for item in strip_private(items)
        ]

    def partners(self, value: Optional[str]) -> Optional[str]:
        """Partner fields can hold several names ('A & B'); shorten each junior and keep the rest untouched."""
        if not value or not (self.enabled or self._opted_in):
            return value
        pieces = [p for p in _PARTNER_SPLIT_RE.split(value) if p.strip()]
        if not any(p.strip().lower() in self._junior or p.strip().lower() in self._opted_in for p in pieces):
            return value
        return " & ".join(self.name(p) for p in pieces)


def public_status(performance_status: Optional[str], is_active: bool = False) -> str:
    """Public schedule status: upcoming | now | done."""
    if is_active or (performance_status or "") == "On Stage":
        return "now"
    if (performance_status or "") in ("Performed", "Done"):
        return "done"
    return "upcoming"
