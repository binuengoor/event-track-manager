// Loads console ES modules in Node without a bundler: copies them next to a
// {"type":"module"} package.json so relative imports resolve.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {pathToFileURL} = require('node:url');

let dir = null;
function stage() {
  if (dir) return dir;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'etm-console-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  const src = path.join(__dirname, '../../app/static/js/console');
  for (const f of fs.readdirSync(src)) if (f.endsWith('.js')) fs.copyFileSync(path.join(src, f), path.join(dir, f));
  return dir;
}
module.exports = {loadConsole: name => import(pathToFileURL(path.join(stage(), `${name}.js`)).href)};
