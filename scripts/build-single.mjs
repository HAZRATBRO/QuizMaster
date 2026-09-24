// Bundles the app into one self-contained HTML file (CSS and JS inlined; pdf.js still loads from the CDN).
// Usage: node scripts/build-single.mjs [out.html] [--fragment] [--sample quiz.json]
//   --fragment  omit <!doctype>/<html>/<head>/<body> for hosts that supply their own skeleton
//   --sample    preload a parsed quiz (from scripts/parse-pdf.mjs --json) on first open

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const out = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--sample') || path.join(root, 'dist/quizmaster.html');

// Modules in dependency order.
const modules = ['parser.js', 'extract.js', 'answerkey.js', 'report.js', 'store.js', 'pdfview.js', 'app.js'];
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
const sample = opt('--sample');
const sampleJs = sample
  ? (() => {
      const parsed = JSON.parse(fs.readFileSync(sample, 'utf8'));
      const quiz = {
        title: opt('--title') || 'Sample paper',
        sourceName: opt('--source') || path.basename(sample),
        pageCount: parsed.stats.pages,
        stats: parsed.stats,
        questions: parsed.questions,
        settings: { minutes: Math.max(5, Math.round(parsed.questions.length * 0.8)), plus: 1, minus: 0.33 },
      };
      return `<script>window.QUIZMASTER_SAMPLE = ${JSON.stringify(quiz).replace(/</g, '\\u003c')};</script>\n`;
    })()
  : '';

const head = `<title>QuizMaster</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans:wght@400;500;600&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap">
<style>
${css}
</style>`;
const body = `<div id="app"><div class="wrap"><p class="muted">Loading QuizMaster…</p></div></div>
${sampleJs}<script type="module">
${chunks.join('\n\n')}
</script>`;

const html = flag('--fragment')
  ? `${head}\n${body}\n`
  : `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n${head}\n</head>\n<body>\n${body}\n</body>\n</html>\n`;

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`Wrote ${out} (${Math.round(html.length / 1024)} KB)`);
