// Bundles the app into one self-contained HTML file (CSS and JS inlined; pdf.js still loads from the CDN).
// Usage: node scripts/build-single.mjs [out.html] [--fragment]
//   --fragment  omit <!doctype>/<html>/<head>/<body> for hosts that supply their own skeleton

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const out = args.find((a) => !a.startsWith('--')) || path.join(root, 'dist/quizmaster.html');

// Modules in dependency order.
const modules = ['parser.js', 'extract.js', 'answerkey.js', 'report.js', 'match.js', 'store.js', 'pdfview.js', 'app.js'];
const ident = (file) => `__mod_${file.replace(/\W/g, '_')}`;

const chunks = modules.map((file) => {
  let src = fs.readFileSync(path.join(root, 'js', file), 'utf8');
  const exported = [];
  src = src.replace(/^export\s+(async\s+)?(function|const|let|class)\s+(\w+)/gm, (_, a, kind, name) => {
    exported.push(name);
    return `${a || ''}${kind} ${name}`;
  });
  src = src.replace(/^export\s+const\s+(\w+)/gm, (_, name) => `const ${name}`);
  src = src.replace(/^import \* as (\w+) from '\.\/([\w.]+)';$/gm, (_, name, dep) => `const ${name} = ${ident(dep)};`);
  src = src.replace(/^import \{([^}]+)\} from '\.\/([\w.]+)';$/gm, (_, names, dep) => `const {${names}} = ${ident(dep)};`);
  if (/^\s*(import|export)\s/m.test(src)) throw new Error(`Unhandled import/export in ${file}`);
  return `const ${ident(file)} = (() => {\n${src}\nreturn { ${exported.join(', ')} };\n})();`;
});

const css = fs.readFileSync(path.join(root, 'css/styles.css'), 'utf8');
// The paper library is embedded, since a single file cannot fetch papers/*.json next to it.
const papersDir = path.join(root, 'papers');
const papers = fs.existsSync(path.join(papersDir, 'index.json'))
  ? JSON.parse(fs.readFileSync(path.join(papersDir, 'index.json'), 'utf8')).map((entry) => ({
      ...entry,
      data: JSON.parse(fs.readFileSync(path.join(papersDir, entry.file), 'utf8')),
    }))
  : [];
const papersJs = papers.length
  ? `<script>window.QUIZMASTER_PAPERS = ${JSON.stringify(papers).replace(/</g, '\\u003c')};</script>\n`
  : '';

const head = `<title>QuizMaster</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans:wght@400;500;600&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap">
<style>
${css}
</style>`;
const body = `<div id="app"><div class="wrap"><p class="muted">Loading QuizMaster…</p></div></div>
${papersJs}<script type="module">
${chunks.join('\n\n')}
</script>`;

const html = flag('--fragment')
  ? `${head}\n${body}\n`
  : `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n${head}\n</head>\n<body>\n${body}\n</body>\n</html>\n`;

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`Wrote ${out} (${Math.round(html.length / 1024)} KB)`);
