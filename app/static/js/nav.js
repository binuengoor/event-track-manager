/**
 * Shared site navigation.
 * Replaces each page's <header><nav> with one consistent component:
 *  - desktop/tablet: inline pills with an accent-coloured active page
 *  - phones: a single menu button opening a compact grid sheet (public links first, staff links separated)
 * Non-link children of the old <nav> (e.g. the admin "PIN Authorized" badge) are preserved.
 */
(function () {
  'use strict';

  const PUBLIC_LINKS = [
    { href: '/', label: 'Home', icon: 'home', accent: 'orange' },
    { href: '/signup', label: 'Sign Up', icon: 'user-plus', accent: 'emerald' },
    { href: '/performer', label: 'Performer Hub', short: 'Performer', icon: 'mic-2', accent: 'orange' },
    { href: '/dashboard', label: 'Dashboard', icon: 'layout-dashboard', accent: 'indigo' },
    { href: '/live', label: 'Live Program', icon: 'radio', accent: 'rose' },
  ];
  const STAFF_LINKS = [
    { href: '/console', label: 'Console', icon: 'shield', accent: 'amber' },
    { href: '/admin', label: 'Admin', icon: 'settings', accent: 'purple' },
  ];

  const ACCENT = {
    orange: { active: 'bg-orange-600 shadow-orange-600/30', icon: 'text-orange-400' },
    emerald: { active: 'bg-emerald-600 shadow-emerald-600/30', icon: 'text-emerald-400' },
    indigo: { active: 'bg-indigo-600 shadow-indigo-600/30', icon: 'text-indigo-400' },
    rose: { active: 'bg-rose-600 shadow-rose-600/30', icon: 'text-rose-400' },
    amber: { active: 'bg-amber-600 shadow-amber-600/30', icon: 'text-amber-400' },
    purple: { active: 'bg-purple-600 shadow-purple-600/30', icon: 'text-purple-400' },
  };

  function isActive(href) {
    const path = window.location.pathname.replace(/\/+$/, '') || '/';
    if (href === '/') return path === '/';
    return path === href || path.startsWith(href + '/');
  }

  function pill(l) {
    const a = ACCENT[l.accent];
    const active = isActive(l.href);
    const cls = active
      ? `${a.active} text-white shadow-md`
      : 'bg-slate-800/70 hover:bg-slate-700/80 text-slate-200 border border-slate-700/80';
    return `<a href="${l.href}" ${active ? 'aria-current="page"' : ''} class="px-3 py-1.5 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 transition ${cls}">
      <i data-lucide="${l.icon}" class="w-3.5 h-3.5 ${active ? 'text-white' : a.icon}"></i><span class="nav-label whitespace-nowrap">${l.short || l.label}</span></a>`;
  }

  function tile(l) {
    const a = ACCENT[l.accent];
    const active = isActive(l.href);
    const cls = active
      ? `${a.active} text-white shadow-md`
      : 'bg-slate-800/70 text-slate-100 border border-slate-700/80 active:bg-slate-700';
    return `<a href="${l.href}" ${active ? 'aria-current="page"' : ''} class="flex items-center gap-2.5 px-3.5 py-3 rounded-2xl text-sm font-semibold transition ${cls}">
      <i data-lucide="${l.icon}" class="w-4 h-4 ${active ? 'text-white' : a.icon}"></i><span class="nav-label">${l.label}</span></a>`;
  }

  function build() {
    const header = document.querySelector('header');
    const oldNav = header && header.querySelector('nav');
    if (!header || !oldNav || header.id === 'control-overlay') return;

    const extras = Array.from(oldNav.children).filter((el) => el.tagName !== 'A');
    const wrapper = document.createElement('div');
    wrapper.className = 'site-nav flex items-center gap-2 shrink-0';

    const extrasHtml = extras.map((e) => e.outerHTML).join('');
    wrapper.innerHTML = `
      ${extrasHtml}
      <nav class="hidden xl:flex items-center gap-1.5 flex-nowrap justify-end" aria-label="Main">
        ${PUBLIC_LINKS.map(pill).join('')}
        <span class="w-px h-5 bg-slate-700 mx-1" aria-hidden="true"></span>
        ${STAFF_LINKS.map(pill).join('')}
      </nav>
      <button type="button" id="site-menu-btn" class="xl:hidden p-2.5 rounded-xl bg-slate-800/70 border border-slate-700/80 text-slate-100 transition active:scale-95" aria-label="Open menu" aria-expanded="false" aria-controls="site-menu-sheet">
        <i data-lucide="menu" class="w-5 h-5"></i>
      </button>`;
    oldNav.replaceWith(wrapper);

    const sheet = document.createElement('div');
    sheet.id = 'site-menu-sheet';
    sheet.className = 'xl:hidden hidden absolute top-full inset-x-0 z-40 px-3 pb-3 pt-2 bg-slate-950/97 backdrop-blur-xl border-b border-slate-800 shadow-2xl shadow-black/50';
    sheet.innerHTML = `
      <div class="grid grid-cols-2 gap-2">${PUBLIC_LINKS.map(tile).join('')}</div>
      <p class="text-[10px] uppercase tracking-widest text-slate-500 font-bold mt-3 mb-1.5 px-1">Staff</p>
      <div class="grid grid-cols-2 gap-2">${STAFF_LINKS.map(tile).join('')}</div>`;
    header.style.position = header.style.position || 'sticky';
    header.appendChild(sheet);

    const btn = wrapper.querySelector('#site-menu-btn');
    const setOpen = (open) => {
      sheet.classList.toggle('hidden', !open);
      btn.setAttribute('aria-expanded', String(open));
      btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      const icon = btn.querySelector('[data-lucide], svg');
      if (icon) {
        btn.innerHTML = `<i data-lucide="${open ? 'x' : 'menu'}" class="w-5 h-5"></i>`;
        if (window.lucide) window.lucide.createIcons();
      }
    };
    btn.addEventListener('click', (e) => { e.stopPropagation(); setOpen(sheet.classList.contains('hidden')); });
    document.addEventListener('click', (e) => { if (!sheet.contains(e.target) && !sheet.classList.contains('hidden')) setOpen(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });
    window.addEventListener('resize', () => { if (window.innerWidth >= 1280) setOpen(false); });

    if (window.lucide) window.lucide.createIcons();
  }

  build();
})();
