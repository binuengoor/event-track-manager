"""Compatibility normalization for event age-group settings."""
import json
from typing import Any, Dict, Iterable, List


def normalize_age_groups(value: Any, fallback: Iterable[Any]) -> List[Dict[str, Any]]:
    """Return the current public/admin shape while accepting older settings without descriptions."""
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (TypeError, ValueError):
            value = None
    fallback_list = list(fallback)
    source = value if isinstance(value, list) and value else fallback_list
    normalized = []
    for item in source:
        if isinstance(item, dict):
            name = item.get("name")
            description = item.get("description", "")
            requires_guardian = item.get("requires_guardian", False)
        else:
            name = getattr(item, "name", None)
            description = getattr(item, "description", "")
            requires_guardian = getattr(item, "requires_guardian", False)
        if not isinstance(name, str) or not name.strip():
            continue
        normalized.append({
            "name": name.strip(),
            "description": description.strip() if isinstance(description, str) else "",
            "requires_guardian": requires_guardian if isinstance(requires_guardian, bool) else False,
        })
    if normalized:
        return normalized
    return normalize_age_groups(fallback_list, []) if source is not fallback_list and fallback_list else []
