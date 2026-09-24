// Browser-side pdf.js: loading the library, reading uploads, and drawing question snippets.

import { loadPdf, extractPages } from './extract.js';

const PDFJS_VERSION = '4.10.38';
const PDFJS_BASE = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build`;

let libPromise = null;
export function pdfjs() {
  if (!libPromise) {
    libPromise = import(`${PDFJS_BASE}/pdf.min.mjs`).then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}/pdf.worker.min.mjs`;
      return lib;
    });
  }
  return libPromise;
}

export async function readPdf(bytes, onProgress) {
  const lib = await pdfjs();
  const doc = await loadPdf(lib, bytes);
  const pages = await extractPages(doc, onProgress);
  return { doc, pages };
}

// ---- snippet rendering ----

const docs = new Map(); // quizId -> Promise<PDFDocumentProxy>
const pageCache = new Map(); // `${quizId}:${page}` -> Promise<canvas>
const PAGE_CACHE_LIMIT = 8;
const SCALE = 2;

export function registerDoc(quizId, docOrPromise) {
  docs.set(quizId, Promise.resolve(docOrPromise));
}

export function hasDoc(quizId) {
  return docs.has(quizId);
}

export async function openStoredDoc(quizId, bytes) {
  if (docs.has(quizId)) return docs.get(quizId);
  const p = pdfjs().then((lib) => loadPdf(lib, bytes));
  docs.set(quizId, p);
  return p;
}

function renderPage(quizId, pageNo) {
  const key = `${quizId}:${pageNo}`;
  if (pageCache.has(key)) {
    const v = pageCache.get(key);
    pageCache.delete(key);
    pageCache.set(key, v); // keep most recently used last
    return v;
  }
  const p = (async () => {
    const doc = await docs.get(quizId);
    const page = await doc.getPage(pageNo);
    const vp = page.getViewport({ scale: SCALE });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(vp.width);
    canvas.height = Math.ceil(vp.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    return canvas;
  })();
  pageCache.set(key, p);
  while (pageCache.size > PAGE_CACHE_LIMIT) pageCache.delete(pageCache.keys().next().value);
  p.catch(() => pageCache.delete(key));
  return p;
}

/** Draws each region of a question as a cropped image into `container`. */
export async function drawSnippet(container, quizId, regions) {
  container.replaceChildren();
  if (!docs.has(quizId) || !regions || !regions.length) return false;
  for (const r of regions) {
    const src = await renderPage(quizId, r.page);
    const w = Math.round((r.x1 - r.x0) * SCALE);
    const h = Math.round((r.y1 - r.y0) * SCALE);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.className = 'snippet-img';
    c.style.aspectRatio = `${w} / ${h}`;
    c.getContext('2d').drawImage(src, Math.round(r.x0 * SCALE), Math.round(r.y0 * SCALE), w, h, 0, 0, w, h);
    c.setAttribute('role', 'img');
    c.setAttribute('aria-label', `Question as printed on page ${r.page}`);
    container.append(c);
  }
  return true;
}
