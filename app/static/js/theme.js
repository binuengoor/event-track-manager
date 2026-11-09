// Guest and admin theme: follows the OS (prefers-color-scheme) unless the person chose one.
// Loaded in <head> before first paint to avoid a flash. Console, monitor and /live never load this file.
(function () {
  var KEY = 'etm-theme', ACCENT_KEY = 'etm-accent';
  var root = document.documentElement;
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;

  function choice() {
    try { var v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : 'system'; } catch (e) { return 'system'; }
  }
  function resolve(c) { return c === 'system' ? (mq && mq.matches ? 'light' : 'dark') : c; }
  function apply() {
    var c = choice(), t = resolve(c);
    root.setAttribute('data-theme', t);
    root.style.colorScheme = t;
    root.style.backgroundColor = t === 'light' ? '#FAF8F5' : '#0B0D10';
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'light' ? '#FAF8F5' : '#0B0D10');
    var cs = document.querySelector('meta[name="color-scheme"]');
    if (cs) cs.setAttribute('content', 'light dark');
    return c;
  }
  function applyAccent() {
    var value = 'coral';
    try { value = localStorage.getItem(ACCENT_KEY) || value; } catch (e) {}
    if (['coral', 'blue', 'green', 'purple'].indexOf(value) < 0) value = 'coral';
    root.setAttribute('data-accent', value);
    return value;
  }
  apply();
  applyAccent();
  document.addEventListener('DOMContentLoaded', function () {
    var mode = document.getElementById('appearance-mode');
    var accent = document.getElementById('appearance-accent');
    if (mode) { mode.value = choice(); mode.addEventListener('change', function () { window.etmTheme.set(mode.value); }); }
    if (accent) { accent.value = applyAccent(); accent.addEventListener('change', function () {
      try { localStorage.setItem(ACCENT_KEY, accent.value); } catch (e) {} applyAccent();
    }); }
  });
  if (mq && mq.addEventListener) mq.addEventListener('change', apply);
  window.addEventListener('storage', function (e) { if (e.key === KEY) apply(); if (e.key === ACCENT_KEY) applyAccent(); });

  // Cycles system -> light -> dark -> system. Returns the new choice.
  window.etmTheme = {
    get: choice,
    set: function (c) { try { if (c === 'system') localStorage.removeItem(KEY); else localStorage.setItem(KEY, c); } catch (e) {} return apply(); },
    cycle: function () { var n = { system: 'light', light: 'dark', dark: 'system' }[choice()]; return this.set(n); },
  };
})();
