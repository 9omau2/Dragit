// Accept only bounded text offsets and known styles, never page HTML/attributes.
export function sourceFormat(text, input) {
  if (!Array.isArray(input)) return [];
  const styles = new Set(['strong', 'em', 'code']);
  const seen = new Set();
  return input.slice(0, 128).filter(span => {
    if (!span || !Number.isInteger(span.start) || !Number.isInteger(span.end) || span.start < 0 || span.end <= span.start || span.end > text.length || !styles.has(span.style)) return false;
    const key = `${span.start}:${span.end}:${span.style}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).map(({ start, end, style }) => ({ start, end, style })).sort((a, b) => a.start - b.start || a.end - b.end || a.style.localeCompare(b.style));
}

export function formattedSource(text, spans) {
  const boundaries = [...new Set([0, text.length, ...spans.flatMap(span => [span.start, span.end])])].sort((a, b) => a - b);
  const segments = boundaries.slice(0, -1).map((start, index) => {
    const end = boundaries[index + 1];
    const styles = ['strong', 'em', 'code'].filter(style => spans.some(span => span.style === style && span.start <= start && span.end >= end));
    return { text: text.slice(start, end), styles };
  });
  return JSON.stringify({ segments });
}
