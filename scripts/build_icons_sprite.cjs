#!/usr/bin/env node
/* Builds app/static/vendor/icons.svg from the vendored lucide bundle (build-time only; the runtime
 * never loads lucide.min.js). Icons = every data-lucide name in app/static HTML/JS, every `icon: '...'`
 * literal, plus EXTRA (names JS assembles at runtime). Usage: node scripts/build_icons_sprite.cjs */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const STATIC = path.join(__dirname, '..', 'app', 'static');
const lucide = require(path.join(STATIC, 'vendor', 'lucide.min.js'));
const EXTRA = ['volume-x', 'lock-open', 'disc', 'check', 'x'];
// Brand icons were dropped from lucide 1.x; kept from the old open path data (ISC).
const MANUAL = {
  youtube: [
    ['path', { d: 'M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17' }],
    ['path', { d: 'm10 15 5-3-5-3z' }],
  ],
};
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'vendor') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(html|js)$/.test(e.name)) out.push(p);
  }
  return out;
}
const names = new Set(EXTRA);
for (const f of walk(STATIC)) {
  const t = fs.readFileSync(f, 'utf8');
  for (const m of t.matchAll(/data-lucide=\\?["']([a-z0-9-]+)["']/g)) names.add(m[1]);
  for (const m of t.matchAll(/\bicon: ?["']([a-z0-9-]+)["']/g)) { if (!m[1].startsWith("text-")) names.add(m[1]); }
}
const pascal = (s) => s.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join('');
const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const missing = [];
let body = '';
for (const n of [...names].sort()) {
  const node = MANUAL[n] || lucide.icons[pascal(n)];
  if (!node) { missing.push(n); continue; }
  const inner = node.map(([tag, a]) => `<${tag} ${Object.entries(a).filter(([k]) => k !== 'key').map(([k, v]) => `${k}="${esc(v)}"`).join(' ')}/>`).join('');
  body += `<symbol id="${n}" viewBox="0 0 24 24">${inner}</symbol>\n`;
}
if (missing.length) { console.error('Missing icons: ' + missing.join(', ')); process.exit(1); }
const svg = `<svg xmlns="http://www.w3.org/2000/svg">\n${body}</svg>\n`;
fs.writeFileSync(path.join(STATIC, 'vendor', 'icons.svg'), svg);
console.log(`icons.svg: ${names.size} icons, ${svg.length} bytes`);
