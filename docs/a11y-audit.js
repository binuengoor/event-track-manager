// Repeatable accessibility audit (Phase 3 acceptance). Paste into the browser console of a running instance
// (e.g. http://localhost:8770, signed in as admin so /admin loads), after serving axe-core locally:
//   npm pack axe-core && tar xzf axe-core-*.tgz package/axe.min.js && (cd package/.. && python3 -m http.server 8800)
// Usage:  await axeScan('/signup','light')   -> serious/critical violations in that theme
//         await targetScan('/signup')        -> interactive elements smaller than 44 px at 390 px wide
window.axeScan = (url, theme) => new Promise(res => {
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;left:0;top:0;width:390px;height:844px;border:0'; document.body.appendChild(f);
  f.onload = () => setTimeout(async () => {
    const w = f.contentWindow;
    if (theme && w.etmTheme) { w.etmTheme.set(theme); await new Promise(r => setTimeout(r, 300)); }
    const s = w.document.createElement('script'); s.src = 'http://localhost:8800/package/axe.min.js';
    await new Promise(ok => { s.onload = ok; w.document.head.appendChild(s); });
    const r = await w.axe.run(w.document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'] });
    f.remove();
    res(r.violations.filter(v => ['serious', 'critical'].includes(v.impact))
      .map(v => `${v.id}: ${v.nodes.length} e.g. ${v.nodes[0].target.join(' ')}`));
  }, 2500);
  f.src = url;
});
window.targetScan = url => new Promise(res => {
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;left:0;top:0;width:390px;height:844px;border:0'; document.body.appendChild(f);
  f.onload = () => setTimeout(() => {
    const bad = [];
    f.contentDocument.querySelectorAll('a[href],button,select,textarea,[role=button],input:not([type=hidden]):not([type=checkbox]):not([type=radio])').forEach(e => {
      const r = e.getBoundingClientRect();
      if (r.width && r.height && !e.closest('[hidden],.hidden') && Math.min(r.width, r.height) < 43.5) bad.push(`${e.id || e.tagName} ${Math.round(r.width)}x${Math.round(r.height)}`);
    });
    f.remove(); res(bad);
  }, 2500);
  f.src = url;
});
