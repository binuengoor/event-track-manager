"""Phase 1 guarantees: the UI is self-contained (no third-party hosts) and vendored files are intact."""
import hashlib
import re
from pathlib import Path

import pytest

STATIC = Path(__file__).resolve().parent.parent / "app" / "static"
URL_RE = re.compile(r"https?://[^\s\"'`)<>\\]+")
REF_RE = re.compile(r"""(?:src|href)=["'](/static/[^"'?#]+)""")

# Hosts allowed in app code: links an organizer would type or see, and XML namespaces
# (not requests). Vendored third-party bundles under static/vendor are not scanned here;
# the browser-level check (all non-local requests aborted) covers their runtime behaviour.
ALLOWED_HOSTS = {
    "maps.google.com",      # venue link on the landing page
    "docs.google.com",      # example URL text in admin settings
    "www.youtube.com",      # example URL text in the performer form
    "youtu.be",             # example URL text in the performer form
    "www.w3.org",           # SVG/XML namespace string, not a request
}
# The Tailwind build stamps its license banner into app.css.
ALLOWED_PER_FILE = {"css/app.css": {"tailwindcss.com"}}


def _app_files(*suffixes):
    for p in sorted(STATIC.rglob("*")):
        if p.is_file() and p.suffix in suffixes and "vendor" not in p.relative_to(STATIC).parts:
            yield p


def _host(url: str) -> str:
    return re.match(r"https?://([A-Za-z0-9.-]*)", url).group(1)


@pytest.mark.parametrize("path", list(_app_files(".html", ".js", ".css")), ids=lambda p: str(p.relative_to(STATIC)))
def test_no_third_party_hosts(path):
    rel = path.relative_to(STATIC).as_posix()
    allowed = ALLOWED_HOSTS | ALLOWED_PER_FILE.get(rel, set())
    bad = []
    for url in URL_RE.findall(path.read_text(encoding="utf-8")):
        host = _host(url)
        # "https://..." placeholders in hint text have no host
        if host in ("", ".", "..."):
            continue
        if host not in allowed:
            bad.append(url)
    assert not bad, f"{rel} references third-party hosts: {bad}"


def test_referenced_static_files_exist():
    missing = []
    for page in STATIC.glob("*.html"):
        for ref in REF_RE.findall(page.read_text(encoding="utf-8")):
            if not (STATIC / ref[len("/static/"):]).is_file():
                missing.append(f"{page.name}: {ref}")
    assert not missing, missing


def test_pages_use_local_css_and_icons():
    pages = sorted(STATIC.glob("*.html"))
    assert len(pages) == 8
    for page in pages:
        text = page.read_text(encoding="utf-8")
        assert "/static/css/app.css" in text, page.name
        assert "/static/js/icons.js" in text, page.name
        assert "lucide.min.js" not in text, f"{page.name} still loads the 470 KB icon library at runtime"


def test_service_worker_precache_is_local():
    sw = (STATIC / "sw.js").read_text(encoding="utf-8")
    assert "http://" not in sw and "https://" not in sw
    shell = re.search(r"SHELL_URLS = \[(.*?)\];", sw, re.S).group(1)
    for url in re.findall(r"'(/[^']+)'", shell):
        path = url.split("?")[0]
        if path.startswith("/static/"):
            assert (STATIC / path[len("/static/"):]).is_file(), url


def test_vendor_checksums_match():
    sums = (STATIC / "vendor" / "CHECKSUMS.sha256").read_text(encoding="utf-8").strip().splitlines()
    assert sums
    listed = set()
    for line in sums:
        digest, name = line.split(None, 1)
        name = name.strip().lstrip("*")
        listed.add(name)
        actual = hashlib.sha256((STATIC / "vendor" / name).read_bytes()).hexdigest()
        assert actual == digest, f"{name} does not match CHECKSUMS.sha256"
    on_disk = {p.relative_to(STATIC / "vendor").as_posix() for p in (STATIC / "vendor").rglob("*") if p.is_file() and p.name != "CHECKSUMS.sha256"}
    assert on_disk == listed, "vendor/ contains files not covered by CHECKSUMS.sha256"
