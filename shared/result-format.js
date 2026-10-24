/* Render validated source structure and inline styles, never raw HTML or links. */
globalThis.DRAGIT_RESULT_FORMAT = (element, text, enabled, sourceCode = [], sourceStyles = []) => {
  text = String(text ?? '');
  if (!enabled || text.length > 100000) { element.textContent = text; return; }
  const escaped = (source, index) => {
    let slashes = 0;
    while (source[--index] === '\\') slashes++;
    return slashes % 2 === 1;
  };
  // Only paired delimiters enclosing content form bold text. Opening/closing
  // punctuation belongs with its content, not with a delimiter on its inside.
  const boldBoundary = (source, index, opening) => {
    if (!source.startsWith('**', index) || escaped(source, index) ||
        (source[index - 1] === '*' && !escaped(source, index - 1)) || source[index + 2] === '*') return false;
    const adjacent = source[opening ? index + 2 : index - 1] || '';
    if (!adjacent || /\s/.test(adjacent)) return false;
    return opening ? !/[\p{Pe}\p{Pf},.!?:;]/u.test(adjacent) : !/[\p{Ps}\p{Pi}]/u.test(adjacent);
  };
  function inline(source, allowed = ['**', '_']) {
    const fragment = document.createDocumentFragment();
    let plain = '';
    const flush = () => { if (plain) fragment.append(document.createTextNode(plain)); plain = ''; };
    for (let index = 0; index < source.length;) {
      if (source[index] === '\\' && /[`*_\\]/.test(source[index + 1] || '')) {
        plain += source[index + 1]; index += 2; continue;
      }
      let marker = '';
      if (source[index] === '`') {
        let end = index;
        while (source[end] === '`') end++;
        marker = source.slice(index, end);
      } else if (allowed.includes('**') && boldBoundary(source, index, true)) marker = '**';
      else if (allowed.includes('_') && source[index] === '_' && !/[\w]/.test(source[index - 1] || '') && /[^\s_]/.test(source[index + 1] || '')) marker = '_';
      if (!marker) { plain += source[index++]; continue; }
      // Fences and multiline markup remain plain text in this inline formatter.
      if (marker.length > 2) {
        const close = source.indexOf(marker, index + marker.length);
        const end = close === -1 ? source.length : close + marker.length;
        plain += source.slice(index, end); index = end; continue;
      }
      let end = source.indexOf(marker, index + marker.length);
      if (marker[0] !== '`') {
        // A closing delimiter must be valid too; code contents are opaque.
        let cursor = index + marker.length;
        end = -1;
        while (cursor < source.length && !/[\r\n]/.test(source[cursor])) {
          if (escaped(source, cursor)) { cursor++; continue; }
          if (source[cursor] === '`') {
            const run = source.slice(cursor).match(/^`+/)[0];
            let close = source.indexOf(run, cursor + run.length);
            while (close !== -1 && (source[close - 1] === '`' || source[close + run.length] === '`')) close = source.indexOf(run, close + run.length);
            if (close !== -1) { cursor = close + run.length; continue; }
          }
          if (source.startsWith(marker, cursor) && /\S/.test(source[cursor - 1] || '') &&
              (marker === '**' ? boldBoundary(source, cursor, false) : !/[\w]/.test(source[cursor + 1] || ''))) {
            end = cursor; break;
          }
          cursor++;
        }
      }
      if (marker[0] === '`') {
        while (end !== -1 && (source[end - 1] === '`' || source[end + marker.length] === '`')) end = source.indexOf(marker, end + marker.length);
      }
      const body = end === -1 ? '' : source.slice(index + marker.length, end);
      if (!body || /[\r\n]/.test(body)) { plain += marker; index += marker.length; continue; }
      flush();
      const node = document.createElement(marker === '**' ? 'strong' : marker === '_' ? 'em' : 'code');
      if (marker[0] !== '`') node.append(inline(body, allowed.filter(value => value !== marker)));
      else node.textContent = body;
      fragment.append(node);
      index = end + marker.length;
    }
    flush();
    return fragment;
  }
  // Validated translation offsets are rendered with a tiny tag allowlist.
  // Never insert the model response as HTML.
  const validBlock = block => block && ['ol', 'ul', 'heading', 'paragraph'].includes(block.type) &&
    Number.isInteger(block.depth) && block.depth >= 0 && block.depth <= 6 &&
    Number.isInteger(block.group) && Number.isSafeInteger(block.number);
  const styles = Array.isArray(sourceStyles) && sourceStyles.length <= 256 && sourceStyles.every(s =>
    s && Number.isInteger(s.start) && Number.isInteger(s.end) && s.start >= 0 && s.end > s.start && s.end <= text.length &&
    Array.isArray(s.styles) && (s.styles.length > 0 || validBlock(s.block)) &&
    (!s.block || validBlock(s.block)) && s.styles.every(style => ['strong', 'em', 'code'].includes(style))) ? sourceStyles : [];
  function styledRange(from, to) {
    const active = styles.filter(s => s.styles.length && s.start < to && s.end > from);
    if (!active.length) return inline(text.slice(from, to));
    const fragment = document.createDocumentFragment();
    const bounds = [...new Set([from, to, ...active.flatMap(s => [Math.max(from, s.start), Math.min(to, s.end)])])].sort((a, b) => a - b);
    for (let i = 0; i < bounds.length - 1; i++) {
      const start = bounds[i], end = bounds[i + 1];
      let node = document.createTextNode(text.slice(start, end));
      for (const style of ['code', 'em', 'strong']) {
        if (!active.some(s => s.start <= start && s.end >= end && s.styles.includes(style))) continue;
        const wrapper = document.createElement(style);
        wrapper.append(node); node = wrapper;
      }
      fragment.append(node);
    }
    return fragment;
  }
  const blocks = styles.filter(s => s.block).sort((a, b) => a.start - b.start);
  let fragment;
  if (blocks.length && !blocks.some((block, index) => index && block.start < blocks[index - 1].end)) {
    fragment = document.createDocumentFragment();
    let cursor = 0, list = null, listKey = '';
    for (const span of blocks) {
      if (text.slice(cursor, span.start).trim()) {
        const gap = document.createElement('div'); gap.className = 'polish-paragraph';
        gap.append(styledRange(cursor, span.start)); fragment.append(gap);
        list = null;
      }
      const block = span.block;
      if (block.type === 'ol' || block.type === 'ul') {
        const key = `${block.type}:${block.group}:${block.depth}`;
        if (!list || listKey !== key) {
          list = document.createElement(block.type); list.className = 'polish-list';
          list.style.marginInlineStart = `${block.depth * 1.25}em`;
          if (block.type === 'ol') list.start = block.number;
          fragment.append(list); listKey = key;
        }
        const item = document.createElement('li');
        if (block.type === 'ol') item.value = block.number;
        item.append(styledRange(span.start, span.end)); list.append(item);
      } else {
        list = null;
        const node = document.createElement('div');
        node.className = block.type === 'heading' ? 'polish-heading' : 'polish-paragraph';
        node.append(styledRange(span.start, span.end)); fragment.append(node);
      }
      cursor = span.end;
    }
    if (text.slice(cursor).trim()) {
      const tail = document.createElement('div'); tail.className = 'polish-paragraph';
      tail.append(styledRange(cursor, text.length)); fragment.append(tail);
    }
  } else fragment = styledRange(0, text.length);
  // Restore exact code terms from the selection when the model omits backticks.
  // Only the selected <code> text is considered; never guess from normal prose.
  const terms = [...new Set(sourceCode)].filter(term => typeof term === 'string' && term.length > 0 && term.length <= 256 && !/[\r\n]/.test(term)).slice(0, 64).sort((a, b) => b.length - a.length);
  if (terms.length) {
    const pattern = new RegExp(terms.map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
    const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) if (!walker.currentNode.parentElement?.closest('code')) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const value = node.textContent, replacement = document.createDocumentFragment();
      let offset = 0;
      for (const match of value.matchAll(pattern)) {
        const start = match.index, end = start + match[0].length;
        if ((/[\w$]/.test(match[0][0]) && /[\w$]/.test(value[start - 1] || '')) || (/[\w$]/.test(match[0].at(-1)) && /[\w$]/.test(value[end] || ''))) continue;
        replacement.append(document.createTextNode(value.slice(offset, start)));
        const code = document.createElement('code'); code.textContent = match[0]; replacement.append(code);
        offset = end;
      }
      if (offset) { replacement.append(document.createTextNode(value.slice(offset))); node.replaceWith(replacement); }
    }
  }
  element.replaceChildren(fragment);
};
