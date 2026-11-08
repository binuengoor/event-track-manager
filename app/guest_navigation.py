"""Render guest navigation with the current event's feature settings."""
from html import escape
import re

from app.features import feature_enabled


# Inline icons (same paths as the design boards) so the bar needs no script and does not shift on load.
_ICONS = {
    'home': '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
    'calendar': '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>',
    'bowl': '<path d="M3 13h18a9 9 0 0 1-18 0z"/><path d="M12 4v4M8 13V9M16 13V9"/>',
    'plus': '<path d="M12 5v14M5 12h14"/>',
    'user': '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
    'live': '<circle cx="12" cy="12" r="2"/><path d="M16.2 7.8a6 6 0 0 1 0 8.4M7.8 16.2a6 6 0 0 1 0-8.4"/>',
}


def _icon(href: str, stage: bool) -> str:
    if href == '/schedule':
        return _ICONS['calendar'] if stage else _ICONS['bowl']
    return _ICONS.get({'/': 'home', '/my-entry': 'user', '/live': 'live'}.get(href, 'home'))


def _svg(inner: str, size: int, width: float) -> str:
    return (f'<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
            f'stroke-width="{width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">{inner}</svg>')


def _slug(href: str) -> str:
    return href.strip('/').replace('/', '-') or 'home'


def render_guest_navigation(html: str, path: str) -> str:
    stage = feature_enabled('stage_performances_enabled')
    food = feature_enabled('food_signup_enabled')
    links = [('/', 'Home')]
    if feature_enabled('dashboard_enabled'):
        links.append(('/schedule', 'Schedule' if stage else 'Food board'))
    if feature_enabled('signup_enabled') or food:
        links.append(('/signup', 'Sign up'))
    if feature_enabled('performer_edits_enabled') or feature_enabled('track_upload_enabled') or food:
        links.append(('/my-entry', 'My entry' if stage else 'My dish'))
    if feature_enabled('live_display_enabled'):
        links.append(('/live', 'Live'))

    def link(href: str, label: str) -> str:
        active = ' aria-current="page"' if href == path else ''
        icon = _icon(href, stage)
        if href == '/signup':
            glyph = f'<span class="gn-plus" aria-hidden="true">{_svg(_ICONS["plus"], 22, 2.4)}</span>'
        else:
            glyph = _svg(icon, 24, 2)
        dot = '<span class="gn-dot" aria-hidden="true"></span>' if href == '/live' else ''
        return (f'<a href="{escape(href, quote=True)}"{active} class="gn-link gn-link-{_slug(href)}">'
                f'{glyph}<span class="gn-label">{escape(label)}</span>{dot}</a>')

    items = ''.join(link(href, label) for href, label in links)
    shell = f'<nav aria-label="Main" class="guest-navigation">{items}</nav>' if len(links) >= 2 else ''
    # Page templates each have one simple nav within their first header.
    pattern = r'(<header\b[^>]*>.*?)(<nav\b[^>]*>.*?</nav>)(.*?</header>)'
    result, count = re.subn(pattern, lambda m: m.group(1) + shell + m.group(3), html, count=1, flags=re.S)
    if count != 1:
        raise ValueError('Guest template has no recognizable header navigation')
    if path != '/live':
        result = result.replace('</body>', '<footer class="guest-admin-link"><a href="/admin">Admin sign-in</a></footer></body>', 1)
    result = result.replace('</head>', '<link rel="stylesheet" href="/static/css/guest-navigation.css"></head>', 1)
    if path != '/live':
        result = result.replace('</body>', '<script src="/static/js/guest-admin.js" defer></script></body>', 1)
    return result.replace('<script src="/static/js/nav.js"></script>', '', 1)
