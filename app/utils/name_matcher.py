import re
from typing import Optional, List


def is_placeholder_song_title(title: Optional[str]) -> bool:
    """Returns True if the song title is empty, whitespace, or a known placeholder."""
    if not title:
        return True
    t = str(title).strip().lower()
    if not t:
        return True
    placeholders = {
        "tbd", "tba", "to be decided", "to be announced",
        "test", "testing", "n/a", "na", "none", "unknown",
        "song title missing", "missing", "pending", "null", "untitled"
    }
    if t in placeholders:
        return True
    if "song title missing" in t:
        return True
    if "(song" in t and "missing)" in t:
        return True
    if re.match(r"^performance\s*(?:#?\d+)?$", t):
        return True
    if re.match(r"^song\s*(?:#?\d+)?$", t):
        return True
    return False


def split_signer_names(raw: Optional[str]) -> List[str]:
    """Splits composite or family signer names (e.g. 'Bijoymon & Bhavatheertha', 'Ishan, Sarina')."""
    if not raw:
        return []
    parts = re.split(r'\s*(?:&|,|\band\b)\s*', str(raw), flags=re.IGNORECASE)
    cleaned = []
    for p in parts:
        p = p.strip()
        if p and p not in cleaned:
            cleaned.append(p)
    return cleaned


def names_match(name_a: Optional[str], name_b: Optional[str]) -> bool:
    """
    Intelligently determines if two person/signer names refer to the same individual or family entity.
    Handles:
    - Exact match (case-insensitive)
    - Single-word name vs multi-word name (e.g. 'Binu' vs 'Binu Pradeep', 'Reema' vs 'Reema Aby')
    - Parenthetical aliases (e.g. 'Ishan (Sarina)' vs 'Ishan Ratheesh')
    - Surnames conflict safety (prevents 'Dhyan Rakesh Madhavan' matching 'Dhyan Menon')
    """
    if not name_a or not name_b:
        return False
    
    a = str(name_a).strip().lower()
    b = str(name_b).strip().lower()
    
    if not a or not b:
        return False
    if a == b:
        return True
        
    tokens_a = split_signer_names(a)
    tokens_b = split_signer_names(b)
    if len(tokens_a) > 1 or len(tokens_b) > 1:
        for ta in tokens_a:
            for tb in tokens_b:
                if names_match(ta, tb):
                    return True
        return False

    def expand_parens(s: str) -> List[str]:
        m = re.match(r"^(.*?)\s*\((.*?)\)$", s)
        if m:
            p1 = m.group(1).strip()
            p2 = m.group(2).strip()
            res = [s]
            if p1:
                res.append(p1)
            if p2:
                res.append(p2)
            return res
        return [s]

    sub_a = expand_parens(a)
    sub_b = expand_parens(b)

    for cand_a in sub_a:
        for cand_b in sub_b:
            if cand_a == cand_b:
                return True
            
            words_a = [w for w in re.split(r"\s+", cand_a) if w]
            words_b = [w for w in re.split(r"\s+", cand_b) if w]
            if not words_a or not words_b:
                continue

            first_a = words_a[0]
            first_b = words_b[0]

            # If both have multiple words:
            # They only match if one's word list is a contiguous sublist of the other
            if len(words_a) > 1 and len(words_b) > 1:
                shorter, longer = (words_a, words_b) if len(words_a) <= len(words_b) else (words_b, words_a)
                match_seq = False
                for i in range(len(longer) - len(shorter) + 1):
                    if longer[i:i+len(shorter)] == shorter:
                        match_seq = True
                        break
                if match_seq:
                    return True
                continue

            # If at least one is a single word and first name is at least 3 characters
            if (len(words_a) == 1 or len(words_b) == 1) and len(first_a) >= 3 and first_a == first_b:
                return True

    return False
