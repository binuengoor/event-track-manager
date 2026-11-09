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


_STAFF_ICONS = {
    '/console': '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 15v-4M12 15V9M17 15v-2"/>',
    '/admin': '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
}
_APPEARANCE = ('<details class="guest-appearance"><summary>Appearance</summary>'
               '<div class="guest-appearance-panel"><label>Mode <select id="appearance-mode">'
               '<option value="system">System</option><option value="light">Light</option>'
               '<option value="dark">Dark</option></select></label>'
               '<label>Accent <select id="appearance-accent"><option value="coral">Coral</option>'
               '<option value="blue">Blue</option><option value="green">Green</option>'
               '<option value="purple">Purple</option></select></label></div></details>')
_HEADER = re.compile(r'<header\b[^>]*>.*?</header>', re.S)
_EXTRA = re.compile(r'<!--header-extra-->(.*?)<!--/header-extra-->', re.S)


def render_guest_navigation(html: str, path: str, *, staff: bool = False, staff_page: bool = False,
                            keep_page_header: bool = False, appearance: bool = True,
                            title_id: str = 'nav-event-title', subtitle_id: str = 'nav-event-subtitle') -> str:
    """Put the one shared site header on a page.

    Every page (guest, live, admin, console) gets the same brand, the same links in the same order and the
    same place for Appearance. `staff` adds the Console and Admin links (signed-in admins and the staff pages).
    Markup a page wraps in <!--header-extra--> ... <!--/header-extra--> inside its own header is carried over.
    `keep_page_header` leaves the page's own header in place below the shared one (the console toolbar)."""
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

    def staff_link(href: str, label: str) -> str:
        active = ' aria-current="page"' if href == path else ''
        return (f'<a href="{href}"{active} title="{label}" class="gn-link gn-staff-link">{_svg(_STAFF_ICONS[href], 20, 2)}'
                f'<span class="gn-label">{label}</span></a>')

    items = ''.join(link(href, label) for href, label in links)
    shell = f'<nav aria-label="Main" class="guest-navigation">{items}</nav>' if len(links) >= 2 or staff else ''
    staff_nav = (f'<nav aria-label="Staff" class="staff-navigation">{staff_link("/console", "Console")}'
                 f'{staff_link("/admin", "Admin")}</nav>') if staff else ''

    found = _HEADER.search(html)
    if not found or (not keep_page_header and '<nav' not in found.group(0)):
        raise ValueError('Page template has no recognizable header navigation')
    extras = ''.join(_EXTRA.findall(found.group(0)))
    classes = 'guest-header' + (' is-staff-page' if staff_page else '')
    header = (f'<header class="{classes}"><a href="/" class="guest-brand" title="Home">'
              f'<span id="{title_id}">Event Track Manager</span>'
              f'<span id="{subtitle_id}">Musical Night</span></a>{shell}'
              f'{extras}<div class="guest-header-end">{staff_nav}{_APPEARANCE if appearance else ""}</div></header>')
    if keep_page_header:
        own = re.sub(r'<nav\b[^>]*>.*?</nav>', '', found.group(0), count=1, flags=re.S)
        own = re.sub(r'^<header\b', '<div', own)
        own = re.sub(r'</header>$', '</div>', own)
        header += own
    result = html[:found.start()] + header + html[found.end():]

    guest_page = not staff_page and path != '/live'
    if guest_page:
        result = result.replace('</body>', '<footer class="guest-admin-link"><a href="/admin">Admin sign-in</a></footer></body>', 1)
    result = result.replace('</head>', '<link rel="stylesheet" href="/static/css/guest-navigation.css?v=2"></head>', 1)
    if guest_page:
        result = result.replace('</body>', '<script src="/static/js/guest-admin.js" defer></script></body>', 1)
    return result.replace('<script src="/static/js/nav.js"></script>', '', 1)
