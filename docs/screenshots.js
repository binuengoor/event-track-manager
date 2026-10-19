const puppeteer = require('puppeteer-core');
const B = 'http://localhost:8770'; // demo instance, see docs/RUNBOOK.md section 9
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const fakeDate = (iso) => `(() => { const R = Date; const off = new R('${iso}').getTime() - R.now(); const F = class extends R { constructor(...a){ if(a.length===0){ super(R.now()+off);} else super(...a);} static now(){ return R.now()+off; } }; window.Date = F; })();`;

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
    args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--enable-webgl','--no-sandbox'] });
  async function open(w, h, dsf, mobile) {
    const p = await browser.newPage();
    await p.setViewport({ width: w, height: h, deviceScaleFactor: dsf, isMobile: !!mobile, hasTouch: !!mobile });
    return p;
  }
  async function login(p) {
    await p.goto(B + '/', { waitUntil: 'networkidle2' });
    await p.evaluate(async () => { await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin:'4321'})}); localStorage.setItem('paattukoottam_pin','4321'); });
  }
  const settle = (p, ms=2500) => new Promise(r => setTimeout(r, ms));
  async function shot(p, path, name, opts={}) {
    await p.goto(B + path, { waitUntil: 'networkidle2' });
    if (opts.fake) { /* applied via evaluateOnNewDocument before goto */ }
    await settle(p, opts.wait || 2500);
    if (opts.pre) await opts.pre(p);
    await p.screenshot({ path: `out/${name}.jpg`, type: 'jpeg', quality: 88, fullPage: !!opts.full });
    console.log('saved', name);
  }

  // ---- Desktop ----
  let d = await open(1280, 860, 1, false);
  await d.evaluateOnNewDocument(fakeDate('2026-09-14T15:00:00-04:00')); // 5 days before the show
  await shot(d, '/', 'landing');
  await shot(d, '/signup', 'signup');
  await shot(d, '/performer?name=Maya%20Nair', 'performer-hub', { wait: 3500, full: false });
  await shot(d, '/dashboard', 'dashboard');
  await shot(d, '/dashboard', 'dashboard-food', { pre: async (p) => { const tabs = await p.$$('button'); for (const t of tabs) { const txt = await p.evaluate(e => e.textContent, t); if (/Food/i.test(txt) && /Potluck/i.test(txt)) { await t.click(); break; } } await settle(p, 1200); } });
  await d.close();

  let l = await open(1280, 860, 1, false);
  await l.evaluateOnNewDocument(fakeDate('2026-09-19T18:30:00-04:00'));
  await shot(l, '/live', 'live', { wait: 3500 });
  await l.close();

  let c = await open(1280, 860, 1, false);
  await login(c);
  await shot(c, '/console', 'console', { wait: 3500 });
  await shot(c, '/admin', 'admin', { wait: 3000 });
  await shot(c, '/admin', 'admin-features', { wait: 2000, pre: async (p) => { const btns = await p.$$('button'); for (const b of btns) { const t = await p.evaluate(e => e.textContent, b); if (/Features/i.test(t)) { await b.click(); break; } } await settle(p, 1200); } });
  await c.close();

  // ---- Phone ----
  let m = await open(390, 844, 2, true);
  await m.evaluateOnNewDocument(fakeDate('2026-09-14T15:00:00-04:00'));
  await shot(m, '/', 'm-landing');
  await shot(m, '/dashboard', 'm-dashboard');
  await shot(m, '/signup', 'm-signup');
  await shot(m, '/', 'm-menu', { pre: async (p) => { await p.click('#site-menu-btn'); await settle(p, 800); } });
  await m.close();
  let ml = await open(390, 844, 2, true);
  await ml.evaluateOnNewDocument(fakeDate('2026-09-19T18:30:00-04:00'));
  await shot(ml, '/live', 'm-live', { wait: 3500 });
  await ml.close();

  // ---- Aurora frames (phone, live page, real time) ----
  let a = await open(390, 844, 1, true);
  await a.evaluateOnNewDocument(fakeDate('2026-09-19T18:30:00-04:00'));
  await a.goto(B + '/live', { waitUntil: 'networkidle2' });
  await settle(a, 2000);
  for (let i = 0; i < 48; i++) {
    await a.screenshot({ path: `frames/f${String(i).padStart(3,'0')}.jpg`, type: 'jpeg', quality: 80, clip: { x: 0, y: 0, width: 390, height: 520 } });
    await settle(a, 350);
  }
  await a.close();
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
