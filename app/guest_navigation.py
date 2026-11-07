"""Render guest navigation with the current event's feature settings."""
from html import escape
import re

from app.features import feature_enabled


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
        colors = 'bg-orange-600 text-white' if active else 'text-slate-100 bg-slate-800 hover:bg-slate-700'
        return (f'<a href="{escape(href, quote=True)}"{active} '
                f'class="px-3 py-3 rounded-xl text-sm font-semibold {colors}">'
                f'{escape(label)}</a>')

    items = ''.join(link(href, label) for href, label in links)
    shell = f'<nav aria-label="Main" class="guest-navigation">{items}</nav>' if len(links) >= 2 and path != '/live' else ''
    # Page templates each have one simple nav within their first header.
    pattern = r'(<header\b[^>]*>.*?)(<nav\b[^>]*>.*?</nav>)(.*?</header>)'
    result, count = re.subn(pattern, lambda m: m.group(1) + shell + m.group(3), html, count=1, flags=re.S)
    if count != 1:
        raise ValueError('Guest template has no recognizable header navigation')
    if path != '/live':
        result = result.replace('</body>', '<footer class="guest-admin-link"><a href="/admin">Admin sign-in</a></footer></body>', 1)
    result = result.replace('</head>', '<link rel="stylesheet" href="/static/css/guest-navigation.css"></head>', 1)
    return result.replace('<script src="/static/js/nav.js"></script>', '', 1)
