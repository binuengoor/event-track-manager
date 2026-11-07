// Minimal QR encoder: byte mode, error correction L, versions 1-6 (up to 134 bytes), mask 0.
// Dual export: browser global EtmQr, Node require().
(function (root) {
  'use strict';
  // [data codewords per block, EC codewords per block, blocks] for level L
  const VERSIONS = [null, [19, 7, 1], [34, 10, 1], [55, 15, 1], [80, 20, 1], [108, 26, 1], [68, 18, 2]];
  const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34]];

  const EXP = new Array(512), LOG = new Array(256);
  (function () {
    let x = 1;
    for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();
  const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

  function rsRemainder(data, ecLen) {
    let gen = [1];
    for (let i = 0; i < ecLen; i++) {
      const next = new Array(gen.length + 1).fill(0);
      for (let j = 0; j < gen.length; j++) { next[j] ^= gen[j]; next[j + 1] ^= mul(gen[j], EXP[i]); }
      gen = next;
    }
    const rem = new Array(ecLen).fill(0);
    for (const b of data) {
      const f = b ^ rem.shift();
      rem.push(0);
      for (let i = 0; i < ecLen; i++) rem[i] ^= mul(gen[i + 1], f);
    }
    return rem;
  }

  function utf8(str) {
    return Array.from(typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(str) : Buffer.from(str, 'utf8'));
  }

  function encode(text) {
    const bytes = utf8(String(text));
    let version = 0;
    for (let v = 1; v <= 6; v++) { const [d, , n] = VERSIONS[v]; if (bytes.length <= d * n - 2) { version = v; break; } }
    if (!version) throw new Error('QR text too long');
    const [dPer, ePer, blocks] = VERSIONS[version];
    const total = dPer * blocks;
    const bits = [];
    const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    put(4, 4); put(bytes.length, 8); bytes.forEach(b => put(b, 8));
    put(0, Math.min(4, total * 8 - bits.length));
    while (bits.length % 8) bits.push(0);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
    for (let pad = 0xec; data.length < total; pad ^= 0xec ^ 0x11) data.push(pad);
    const dBlocks = [], eBlocks = [];
    for (let b = 0; b < blocks; b++) { const d = data.slice(b * dPer, (b + 1) * dPer); dBlocks.push(d); eBlocks.push(rsRemainder(d, ePer)); }
    const codewords = [];
    for (let i = 0; i < dPer; i++) dBlocks.forEach(d => codewords.push(d[i]));
    for (let i = 0; i < ePer; i++) eBlocks.forEach(e => codewords.push(e[i]));

    const size = 17 + 4 * version;
    const m = Array.from({ length: size }, () => new Array(size).fill(false));
    const fn = Array.from({ length: size }, () => new Array(size).fill(false));
    const set = (r, c, v) => { m[r][c] = v; fn[r][c] = true; };
    const finder = (r0, c0) => {
      for (let dr = -1; dr <= 7; dr++) for (let dc = -1; dc <= 7; dc++) {
        const r = r0 + dr, c = c0 + dc;
        if (r < 0 || c < 0 || r >= size || c >= size) continue;
        const on = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6 && (dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
        set(r, c, on);
      }
    };
    finder(0, 0); finder(0, size - 7); finder(size - 7, 0);
    for (let i = 8; i < size - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    const al = ALIGN[version];
    for (const r of al) for (const c of al) {
      if ((r === 6 && c === 6) || (r === 6 && c === al[al.length - 1]) || (c === 6 && r === al[al.length - 1])) continue;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
    }
    // reserve format areas, dark module
    for (let i = 0; i < 9; i++) { fn[8][i] = true; fn[i][8] = true; }
    for (let i = 0; i < 8; i++) { fn[8][size - 1 - i] = true; fn[size - 1 - i][8] = true; }
    set(size - 8, 8, true);

    // data placement
    let idx = 0, up = true;
    for (let c = size - 1; c > 0; c -= 2) {
      if (c === 6) c = 5;
      for (let i = 0; i < size; i++) {
        const r = up ? size - 1 - i : i;
        for (let k = 0; k < 2; k++) {
          const cc = c - k;
          if (fn[r][cc]) continue;
          let bit = false;
          if (idx < codewords.length * 8) bit = ((codewords[idx >> 3] >>> (7 - (idx & 7))) & 1) === 1;
          idx++;
          m[r][cc] = bit !== ((r + cc) % 2 === 0);
        }
      }
      up = !up;
    }
    // format info: level L (01), mask 0
    let fmt = 0b01000;
    let rem = fmt << 10;
    for (let i = 14; i >= 10; i--) if ((rem >>> i) & 1) rem ^= 0x537 << (i - 10);
    const fbits = ((fmt << 10) | rem) ^ 0x5412;
    const fb = i => ((fbits >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) m[i][8] = fb(i);
    m[7][8] = fb(6); m[8][8] = fb(7); m[8][7] = fb(8);
    for (let i = 9; i < 15; i++) m[8][14 - i] = fb(i);
    for (let i = 0; i < 8; i++) m[8][size - 1 - i] = fb(i);
    for (let i = 8; i < 15; i++) m[size - 15 + i][8] = fb(i);
    return { size, version, modules: m };
  }

  function toSvg(text, opts) {
    const { size, modules } = encode(text);
    const quiet = 4, n = size + quiet * 2;
    let path = '';
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (modules[r][c]) path += `M${c + quiet} ${r + quiet}h1v1h-1z`;
    const label = (opts && opts.label) || '';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" role="img" aria-label="${label.replace(/"/g, '&quot;')}"><rect width="${n}" height="${n}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
  }

  const api = { encode, toSvg };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.EtmQr = api;
})(typeof self !== 'undefined' ? self : this);
