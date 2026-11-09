/* Admin sign-in for guest pages: PIN dialog (boards GAdminPin / GAdminPinLockout) and the "where to?" chooser (GAdminChooser).
 * Opens from any element with [data-admin-signin] and from the footer "Admin sign-in" link, which stays a plain link to /admin
 * when scripts are off. Signs in with POST /api/auth/login (same cookie the admin and console pages use). */
(function () {
  'use strict';

  var MAX_DIGITS = 10;
  var MIN_DOTS = 4;
  var NS = 'http://www.w3.org/2000/svg';
  var ICON = {
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    back: '<path d="M21 5H9l-6 7 6 7h12z"/><path d="M13 9l4 6M17 9l-4 6"/>',
    warn: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>',
    console: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 15v-4M12 15V9M17 15v-2"/>',
    admin: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
    live: '<circle cx="12" cy="12" r="2"/><path d="M16.2 7.8a6 6 0 0 1 0 8.4M7.8 16.2a6 6 0 0 1 0-8.4"/>',
    monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  };

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function icon(name, size) {
    var s = document.createElementNS(NS, 'svg');
    s.setAttribute('width', size); s.setAttribute('height', size); s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2');
    s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
    s.setAttribute('aria-hidden', 'true'); s.setAttribute('focusable', 'false');
    s.innerHTML = ICON[name];
    return s;
  }
  function fmt(secs) {
    var m = Math.floor(secs / 60), s = secs % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }
  function brandName() {
    var n = document.querySelector('#nav-event-title, header h1');
    return (n && n.textContent.trim()) || '';
  }
  function focusables(root) {
    return Array.prototype.filter.call(
      root.querySelectorAll('a[href], button, input, [tabindex]:not([tabindex="-1"])'),
      function (n) { return !n.disabled && n.offsetParent !== null; });
  }

  var layer = null;       // current scrim or chooser element
  var returnFocus = null;
  var onKey = null;
  var timer = null;

  function close() {
    if (timer) { clearInterval(timer); timer = null; }
    if (onKey) { document.removeEventListener('keydown', onKey, true); onKey = null; }
    if (layer) { layer.remove(); layer = null; }
    document.body.style.overflow = '';
    document.documentElement.removeAttribute('data-gad-open');
    if (returnFocus && returnFocus.focus) returnFocus.focus();
    returnFocus = null;
  }

  function trap(root, handler) {
    onKey = function (e) {
      if (e.key === 'Tab') {
        var f = focusables(root);
        if (!f.length) return;
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        else if (!root.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
        return;
      }
      if (handler) handler(e);
    };
    document.addEventListener('keydown', onKey, true);
  }

  function openPin(trigger) {
    if (layer) return;
    returnFocus = trigger || document.activeElement;
    var pin = '';
    var locked = false;
    var busy = false;

    var scrim = el('div', 'gad-scrim');
    var dlg = el('div', 'gad-dialog');
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-modal', 'true');
    dlg.setAttribute('aria-labelledby', 'gad-title');

    var head = el('div', 'gad-head');
    var lock = el('span', 'gad-lock'); lock.appendChild(icon('lock', 22));
    var title = el('h2', 'gad-title', 'Admin sign-in'); title.id = 'gad-title';
    head.append(lock, title, el('p', 'gad-sub', 'Enter the 4-digit Admin PIN'));

    var banner = el('div', 'gad-alert'); banner.hidden = true; banner.setAttribute('role', 'status'); banner.setAttribute('aria-live', 'off');
    var bannerBody = el('div');
    var bannerMsg = el('strong');
    var bannerTime = el('small');
    bannerBody.append(bannerMsg, bannerTime);
    banner.append(icon('warn', 20), bannerBody);

    var dots = el('div', 'gad-dots'); dots.setAttribute('role', 'img');
    var error = el('p', 'gad-error'); error.setAttribute('role', 'alert');

    var pad = el('div', 'gad-pad');
    var keys = [];
    function key(label, text, cls) {
      var b = el('button', 'gad-key' + (cls ? ' ' + cls : ''), text);
      b.type = 'button'; b.setAttribute('aria-label', label);
      keys.push(b);
      return b;
    }
    '123456789'.split('').forEach(function (d) { var b = key(d, d); b.addEventListener('click', function () { add(d); }); pad.appendChild(b); });
    var spacer = el('span'); spacer.setAttribute('aria-hidden', 'true'); pad.appendChild(spacer);
    var zero = key('0', '0'); zero.addEventListener('click', function () { add('0'); }); pad.appendChild(zero);
    var del = key('Delete last digit', '', 'alt'); del.appendChild(icon('back', 26)); del.addEventListener('click', back); pad.appendChild(del);

    var submit = el('button', 'gad-btn primary', 'Sign in'); submit.type = 'button';
    var hint = el('p', 'gad-hint', 'Tap Sign in after entering all 4 digits.');
    var cancel = el('button', 'gad-btn quiet', 'Cancel'); cancel.type = 'button';
    cancel.addEventListener('click', close);
    submit.addEventListener('click', send);

    dlg.append(head, banner, dots, error, pad, submit, hint, cancel);
    scrim.appendChild(dlg);
    document.body.appendChild(scrim);
    document.body.style.overflow = 'hidden';
    document.documentElement.setAttribute('data-gad-open', '');
    layer = scrim;
    paint();
    keys[0].focus();

    trap(dlg, function (e) {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (locked || busy) return;
      if (/^\d$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault(); add(e.key);
        // Typists: move off the keypad so Enter submits instead of pressing the focused key.
        if (e.target.classList && e.target.classList.contains('gad-key') && !submit.disabled) submit.focus();
      }
      else if (e.key === 'Backspace') { e.preventDefault(); back(); }
      else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') { e.preventDefault(); send(); }
    });

    function paint() {
      var n = Math.max(MIN_DOTS, pin.length);
      dots.textContent = '';
      for (var i = 0; i < n; i++) dots.appendChild(el('span', i < pin.length ? 'on' : ''));
      dots.setAttribute('aria-label', pin.length + ' of ' + n + ' digits entered');
      submit.disabled = locked || busy || pin.length === 0;
      hint.hidden = locked;
      submit.hidden = locked;
      keys.forEach(function (k) { k.disabled = locked; k.setAttribute('aria-disabled', locked ? 'true' : 'false'); });
    }
    function add(d) { if (locked || busy || pin.length >= MAX_DIGITS) return; error.textContent = ''; pin += d; paint(); }
    function back() { if (locked || busy) return; pin = pin.slice(0, -1); error.textContent = ''; paint(); }

    function lockout(seconds) {
      locked = true; pin = ''; error.textContent = '';
      var end = Date.now() + seconds * 1000;
      var mins = Math.max(1, Math.ceil(seconds / 60));
      bannerMsg.textContent = 'Too many tries. Wait ' + mins + ' minute' + (mins === 1 ? '' : 's') + ' and try again.';
      banner.hidden = false;
      paint();
      function tick() {
        var left = Math.max(0, Math.round((end - Date.now()) / 1000));
        bannerTime.textContent = '';
        bannerTime.append('Try again in ', Object.assign(el('b'), { textContent: fmt(left) }));
        if (left <= 0) {
          clearInterval(timer); timer = null; locked = false; banner.hidden = true; paint(); keys[0].focus();
        }
      }
      tick();
      timer = setInterval(tick, 1000);
      cancel.focus();
    }

    async function send() {
      if (locked || busy || !pin) return;
      busy = true; error.textContent = ''; submit.textContent = 'Signing in...'; paint();
      try {
        var res = await fetch('/api/auth/login', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pin: pin }),
        });
        if (res.ok) { busy = false; chooser(); return; }
        var data = {};
        try { data = await res.json(); } catch (e) { /* no body */ }
        busy = false; submit.textContent = 'Sign in';
        if (res.status === 429) { lockout(Number(data.retry_after) || Number(res.headers.get('Retry-After')) || 300); return; }
        pin = '';
        error.textContent = "That PIN didn't match. Try again.";
        dots.classList.remove('shake'); void dots.offsetWidth; dots.classList.add('shake');
        paint(); keys[0].focus();
      } catch (e) {
        busy = false; submit.textContent = 'Sign in';
        error.textContent = "Can't reach the server. Check your connection and try again.";
        paint();
      }
    }
  }

  function chooser() {
    var from = returnFocus;
    close();
    returnFocus = from;
    var page = el('div', 'gad-chooser');
    page.setAttribute('role', 'dialog'); page.setAttribute('aria-modal', 'true'); page.setAttribute('aria-labelledby', 'gad-ch-title');
    var head = el('div');
    var h = el('h2', null, 'Signed in as Admin'); h.id = 'gad-ch-title'; h.tabIndex = -1;
    head.append(el('span', 'gad-eyebrow', brandName()), h, el('p', 'q', 'Where do you want to go?'));
    function choice(href, ic, label, desc, primary) {
      var a = el('a', 'gad-choice' + (primary ? ' primary' : '')); a.href = href;
      var t = el('span'); t.append(el('b', null, label), el('span', 'd', desc));
      a.append(icon(ic, 32), t);
      return a;
    }
    var row = el('div', 'gad-mini-row');
    [['/live', 'live', 'Live screen'], ['/console/stage-monitor', 'monitor', 'Stage monitor']].forEach(function (x) {
      var a = el('a', 'gad-mini'); a.href = x[0]; a.append(icon(x[1], 18), document.createTextNode(x[2])); row.appendChild(a);
    });
    var done = el('button', 'gad-btn gad-close', 'Close'); done.type = 'button'; done.addEventListener('click', close);
    var out = el('button', 'gad-btn gad-signout', 'Sign out'); out.type = 'button';
    out.addEventListener('click', function () {
      fetch('/api/auth/logout', { method: 'POST' }).catch(function () {}).then(function () {
        try { localStorage.removeItem('paattukoottam_pin'); } catch (e) {}
        close();
      });
    });
    var actions = el('div', 'gad-actions'); actions.append(out, done);
    page.append(head,
      choice('/console', 'console', 'Open Console', 'Run the show: cue tracks and play them from the sound desk.', true),
      choice('/admin', 'admin', 'Open Admin', 'Overview, lineup, people and potluck, setup and rules.', false),
      row, actions);

    fetch('/api/auth/pin-status')
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        if (data && data.is_default) {
          var warn = el('div', 'gad-warning');
          warn.setAttribute('role', 'alert');
          warn.style.cssText = 'background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 8px; padding: 10px 14px; margin-bottom: 16px; font-size: 13px; color: var(--text-primary); display: flex; align-items: center; gap: 8px;';
          warn.append(icon('admin', 18), document.createTextNode('Default admin PIN is in use. Change it in Admin \u2192 Settings.'));
          head.after(warn);
        }
      })
      .catch(function () {});

    document.body.appendChild(page);
    document.body.style.overflow = 'hidden';
    layer = page;
    trap(page, function (e) { if (e.key === 'Escape') { e.preventDefault(); close(); } });
    h.focus();
  }

  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-admin-signin], .guest-admin-link a');
    if (!t || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    e.preventDefault();
    openPin(t);
  });
  window.etmAdminSignIn = { open: openPin, close: close };
})();
