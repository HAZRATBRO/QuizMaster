// Plain-text rendering of a parsed question (used by the CLI report and for copying).
export function formatQuestion(q) {
  const out = [`Q${q.num}.`];
  for (const b of q.stem) {
    if (b.type === 'p') out.push(`  ${b.text}`);
    else for (const row of b.rows) out.push(`  | ${row.join(' | ')} |`);
  }
  q.options.forEach((o, i) => out.push(`   (${i + 1}) ${o}`));
  if (q.answer !== null && q.answer !== undefined) out.push(`   Answer: ${q.answer + 1}`);
  for (const w of q.warnings) out.push(`   ! ${w}`);
  return out.join('\n');
}
