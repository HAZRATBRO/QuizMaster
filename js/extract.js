// Turns a PDF into positioned text items, one entry per page.
// Works with any pdf.js build (browser or Node), which is passed in by the caller.

export async function loadPdf(pdfjsLib, data) {
  // pdf.js transfers the buffer to its worker, so give it a copy.
  const copy = data instanceof Uint8Array ? data.slice() : new Uint8Array(data.slice(0));
  return pdfjsLib.getDocument({ data: copy, isEvalSupported: false }).promise;
}

export async function extractPages(doc, onProgress) {
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const items = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const [a, b, c, d, e, f] = it.transform;
      if (Math.abs(b) > 0.01 || Math.abs(c) > 0.01 || a <= 0) continue; // rotated text / watermarks
      const size = Math.abs(d) || Math.abs(a);
      const baseline = vp.height - f;
      items.push({
        str: it.str,
        x: e,
        w: it.width || it.str.length * size * 0.5,
        baseline,
        size,
      });
    }
    pages.push({ page: n, width: vp.width, height: vp.height, items });
    page.cleanup();
    if (onProgress) onProgress(n, doc.numPages);
  }
  return pages;
}
