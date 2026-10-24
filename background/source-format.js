// Send a continuous passage with paired markers, never page HTML or attributes.
export function markSource(text, input) {
  const spans = Array.isArray(input) ? input.slice(0, 128).filter(s => s &&
    Number.isInteger(s.start) && Number.isInteger(s.end) && s.start >= 0 &&
    s.end > s.start && s.end <= text.length && (['strong', 'em', 'code'].includes(s.style) ||
      (s.style === 'block' && s.block && ['ol', 'ul', 'heading', 'paragraph'].includes(s.block.type) &&
       Number.isInteger(s.block.depth) && s.block.depth >= 0 && s.block.depth <= 6 &&
       Number.isInteger(s.block.group) && Number.isSafeInteger(s.block.number)))) : [];
  const blocks = spans.filter(s => s.style === 'block').sort((a, b) => a.start - b.start);
  // Block ranges must be disjoint; nested DOM lists are flattened into item runs.
  if (blocks.some((block, index) => index && block.start < blocks[index - 1].end)) {
    return markSource(text, spans.filter(s => s.style !== 'block'));
  }
  const bounds = [...new Set([0, text.length, ...spans.flatMap(s => [s.start, s.end])])].sort((a, b) => a - b);
  const runs = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const start = bounds[i], end = bounds[i + 1];
    const styles = ['strong', 'em', 'code'].filter(style => spans.some(s => s.style === style && s.start <= start && s.end >= end));
    const block = blocks.find(s => s.start <= start && s.end >= end);
    const previous = runs.at(-1);
    if (previous && previous.block === block && previous.styles.join() === styles.join()) previous.text += text.slice(start, end);
    else runs.push({ text: text.slice(start, end), styles, block });
  }
  // Excessively fragmented selections use normal translation instead.
  if (runs.filter(r => r.styles.length).length > 64) return { text, markers: [] };
  let prefix = 'd';
  while (text.includes(`⟦${prefix}`) || text.includes(`⟦/${prefix}`)) prefix += 'd';
  const markers = [];
  let marked = '', activeBlock, blockId;
  for (const run of runs) {
    if (activeBlock !== run.block) {
      if (blockId) marked += `⟦/${blockId}⟧`;
      activeBlock = run.block;
      blockId = null;
      if (activeBlock) {
        blockId = `${prefix}b${markers.length}`;
        markers.push({ id: blockId, styles: [], block: { ...activeBlock.block } });
        marked += `⟦${blockId}⟧`;
      }
    }
    if (!run.styles.length) marked += run.text;
    else {
      const id = `${prefix}${run.styles.includes('code') ? 'c' : 't'}${markers.length}`;
      markers.push({ id, styles: run.styles });
      marked += `⟦${id}⟧${run.text}⟦/${id}⟧`;
    }
  }
  if (blockId) marked += `⟦/${blockId}⟧`;
  return { text: marked, markers };
}

export function readMarkedTranslation(output, markers) {
  if (!markers.length) return { translation: output, formatting: [] };
  const known = new Map(markers.map(m => [m.id, m]));
  const pattern = new RegExp(`⟦(/?)(${markers.map(m => m.id).join('|')})⟧`, 'g');
  const stack = [], seen = new Set(), formatting = [];
  let translation = '', cursor = 0, valid = true;
  for (const match of output.matchAll(pattern)) {
    translation += output.slice(cursor, match.index);
    cursor = match.index + match[0].length;
    const id = match[2];
    if (!match[1]) {
      if (seen.has(id)) valid = false;
      seen.add(id);
      stack.push({ id, start: translation.length });
    } else {
      const open = stack.pop();
      if (!open || open.id !== id || open.start === translation.length) { valid = false; continue; }
      const marker = known.get(id);
      formatting.push({ start: open.start, end: translation.length, styles: marker.styles,
        ...(marker.block ? { block: marker.block } : {}) });
    }
  }
  translation += output.slice(cursor);
  // Missing, duplicated or crossed markers never produce partially wrong styles.
  valid &&= stack.length === 0 && seen.size === markers.length && formatting.length === markers.length;
  return { translation, formatting: valid ? formatting.sort((a, b) => a.start - b.start) : [] };
}
