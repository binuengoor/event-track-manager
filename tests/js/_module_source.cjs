// Console modules are ES modules, but some tests run their code in a vm context with injected stubs for every
// imported name. This turns module files into one plain script: imports dropped (the context supplies those
// names as globals), `export` keywords removed.
const fs = require('node:fs');
const path = require('node:path');

const consoleDir = path.join(__dirname, '../../app/static/js/console');

function plainScript(...files) {
  return files.map(f => {
    const src = fs.readFileSync(path.join(consoleDir, f), 'utf8');
    return src
      .replace(/^import\s[\s\S]*?\sfrom\s*["'][^"']+["'];?[ \t]*$/gm, '')
      .replace(/^export\s+(?=(async\s+function|function|const|let|class)\b)/gm, '');
  }).join('\n');
}

module.exports = {plainScript};
