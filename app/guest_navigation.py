"""Render guest navigation with the current event's feature settings."""
from html import escape
import re

from app.features import feature_enabled


def render_guest_navigation(html: str, path: str) -> str:
    stage = feature_enabled('stage_performances_enabled')
    signup = feature_enabled('signup_enabled') or feature_enabled('food_signup_enabled')
    links = [('/', 'Home')]
    if signup:
        links.append(('/signup', 'Sign up'))
    links.append(('/performer', 'Performer Hub' if stage else 'Attendee Hub'))
    if feature_enabled('dashboard_enabled'):
        links.append(('/dashboard', 'Dashboard' if stage else 'Food Board'))
    if feature_enabled('live_display_enabled'):
        links.append(('/live', 'Live'))
    links.append(('/admin', 'Admin sign-in'))

    def link(href: str, label: str) -> str:
        active = ' aria-current="page"' if href == path else ''
        colors = 'bg-orange-600 text-white' if active else 'text-slate-100 bg-slate-800 hover:bg-slate-700'
        return (f'<a href="{escape(href, quote=True)}"{active} '
                f'class="px-3 py-3 rounded-xl text-sm font-semibold {colors}">'
                f'{escape(label)}</a>')

    items = ''.join(link(href, label) for href, label in links)
    shell = (f'<nav aria-label="Main" class="hidden xl:flex items-center gap-2">{items}</nav>'
             '<details class="xl:hidden relative"><summary class="cursor-pointer px-4 py-3 '
             'rounded-xl bg-slate-800 text-slate-100">Menu</summary>'
             f'<nav aria-label="Mobile" class="absolute right-0 z-50 grid gap-2 p-3 '
             f'rounded-xl bg-slate-900 shadow-xl">{items}</nav></details>')
    # Page templates each have one simple nav within their first header.
    pattern = r'(<header\b[^>]*>.*?)(<nav\b[^>]*>.*?</nav>)(.*?</header>)'
    result, count = re.subn(pattern, lambda m: m.group(1) + shell + m.group(3), html, count=1, flags=re.S)
    if count != 1:
        raise ValueError('Guest template has no recognizable header navigation')
    return result.replace('<script src="/static/js/nav.js"></script>', '', 1)
