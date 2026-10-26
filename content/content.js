/* Translate explicit selections without changing the page text. */
(() => {
  if (window.__AI_TRANSLATOR_INITIALIZED__) return;
  window.__AI_TRANSLATOR_INITIALIZED__ = true;
  const { maxChars, selectionEnabled } = globalThis.AI_TRANSLATOR_DEFAULTS;
  const settingKeys = ['selectionEnabled', 'targetLang', 'selectedDomainId', 'domainPresets', 'geminiModel', 'chameleonEnabled', 'resultFormatEnabled', 'resultFontFamily', 'resultFontSize'];
  let settings = { selectionEnabled };
  let host, root, iconHost, panel, selectionButton, result, status, retry;
  let pendingSelection = null;
  let timer, pointerDown = false, sequence = 0, activeRequest = null;
  let lastPayload = null;
  let rawResult = '';
  let resultCodeTerms = [];
  let resultFormatting = [];
  function renderResult(text = rawResult) {
    rawResult = text;
    globalThis.DRAGIT_RESULT_FONTS.apply(result, settings);
    globalThis.DRAGIT_RESULT_FORMAT(result, rawResult, settings.resultFormatEnabled === true, resultCodeTerms, resultFormatting);
  }
  let themeAnchor, themeFrame, themeSamples = [];
  const themeObserver = new MutationObserver(() => scheduleTheme());
  function scheduleTheme() {
    cancelAnimationFrame(themeFrame);
    if (host?.isConnected && settings.chameleonEnabled) themeFrame = requestAnimationFrame(applyTheme);
  }
  function applyTheme() {
    if (!panel) return;
    for (const property of [...panel.style]) if (property.startsWith('--panel-')) panel.style.removeProperty(property);
    if (settings.chameleonEnabled && themeAnchor?.isConnected) {
      const palette = globalThis.DRAGIT_CHAMELEON.palette(themeAnchor, themeSamples);
      for (const [property, value] of Object.entries(palette)) panel.style.setProperty(property, value);
    }
  }
  function watchTheme(anchor) {
    themeObserver.disconnect();
    themeAnchor = anchor;
    applyTheme();
    if (!settings.chameleonEnabled) return;
    const observed = new Set();
    for (const source of [anchor, ...themeSamples.map(sample => sample.element)]) {
      for (let node = source; node && !observed.has(node); node = node.parentElement) {
        observed.add(node);
        themeObserver.observe(node, { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-color-mode', 'data-dark-mode'] });
      }
    }
  }
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', scheduleTheme);
  const editable = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]';

  function ensureUI() {
    if (host) return;
    host = document.createElement('span');
    host.id = 'ai-selection-translator';
    host.style.cssText = 'all:initial!important;display:block!important;position:static!important;float:none!important;clear:both!important;width:auto!important;max-width:100%!important;min-width:0!important;margin:6px 0!important;box-sizing:border-box!important;text-indent:0!important;';
    // In grid-based lists, use the full row rather than the narrow marker column.
    host.style.setProperty('grid-column', '1 / -1', 'important');
    root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = chrome.runtime.getURL('content/content.css') + '?v=inline-code-2';
    root.append(style);
    const ui = document.createElement('div');
    ui.innerHTML = `
      <section class="panel" hidden role="region" aria-label="번역 결과">
        <header><strong><span class="result-symbol">❋</span> Result</strong><button class="close" type="button" aria-label="번역 창 닫기">×</button></header>
        <div class="status" hidden role="status" aria-live="polite"></div>
        <div class="translation-body"><div class="result" dir="auto"></div></div>
        <button class="retry" type="button" hidden>다시 시도</button>
      </section>`;
    root.append(ui);
    panel = root.querySelector('.panel');
    result = root.querySelector('.result');
    status = root.querySelector('.status');
    retry = root.querySelector('.retry');
    root.querySelector('.close').addEventListener('click', closePanel);
    retry.addEventListener('click', () => lastPayload && translate(...lastPayload));
    // Keep the selection icon separate from the inline result's document flow.
    iconHost = document.createElement('span');
    iconHost.id = 'ai-translator-selection-icon';
    iconHost.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;';
    const iconRoot = iconHost.attachShadow({ mode: 'closed' });
    iconRoot.append(style.cloneNode());
    selectionButton = document.createElement('button');
    selectionButton.type = 'button';
    selectionButton.className = 'selection-button';
    selectionButton.hidden = true;
    selectionButton.title = '선택한 글 번역';
    selectionButton.setAttribute('aria-label', '선택한 글 번역');
    selectionButton.textContent = '文A';
    selectionButton.addEventListener('pointerdown', event => event.preventDefault());
    selectionButton.addEventListener('click', () => {
      const selection = pendingSelection;
      hideSelectionButton();
      if (selection) translate(selection.text, '선택한 글', '', selection.anchor, selection.codeTerms, selection.formatting, selection.themeSamples);
    });
    iconRoot.append(selectionButton);
    document.documentElement.append(iconHost);
  }

  function cancelActive() {
    sequence++;
    if (activeRequest) {
      void globalThis.DRAGIT_RUNTIME.cancel(activeRequest);
      activeRequest = null;
    }
  }

  function closePanel() {
    themeObserver.disconnect();
    cancelAnimationFrame(themeFrame);
    clearTimeout(timer);
    cancelActive();
    if (panel) panel.hidden = true;
    host?.remove();
    hideSelectionButton();
  }

  function selectionText() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return '';
    const start = selection.anchorNode?.parentElement;
    const end = selection.focusNode?.parentElement;
    if (!start || !end || start.getRootNode() === root || end.getRootNode() === root || host?.contains(start) || host?.contains(end) ||
        start.closest(editable) || end.closest(editable) || document.activeElement?.closest(editable)) return '';
    return selection.toString().trim();
  }

  function selectionCodeTerms() {
    const selection = getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) return [];
    const range = selection.getRangeAt(0);
    const terms = [...range.cloneContents().querySelectorAll('code')].map(node => node.textContent.trim());
    const common = range.commonAncestorContainer;
    const element = common.nodeType === Node.ELEMENT_NODE ? common : common.parentElement;
    if (element?.closest('code')) terms.push(selection.toString().trim());
    return [...new Set(terms)].filter(term => term && term.length <= 256 && !/[\r\n]/.test(term)).slice(0, 64);
  }

  function tableLayout(table) {
    const rows = [...table.rows];
    if (rows.length > 128 || table.querySelector('table')) return null;
    const occupied = [], cells = new Map();
    let columns = 0;
    for (let row = 0; row < rows.length; row++) {
      let column = 0;
      for (const cell of rows[row].cells) {
        while (occupied[row]?.[column]) column++;
        const colSpan = cell.colSpan;
        const sectionRemaining = rows[row].parentElement.rows.length - rows[row].sectionRowIndex;
        const rowSpan = Math.min(cell.rowSpan || sectionRemaining, sectionRemaining);
        if (column + colSpan > 64 || rowSpan > 128) return null;
        for (let r = row; r < row + rowSpan; r++) {
          occupied[r] ||= [];
          for (let c = column; c < column + colSpan; c++) {
            if (occupied[r][c]) return null;
            occupied[r][c] = true;
          }
        }
        cells.set(cell, { row, column, rowSpan, colSpan, header: cell.matches('th') || rows[row].parentElement.matches('thead') ||
          (row === 0 && table.matches('[data-ke-style="style12"]')) });
        column += colSpan;
        columns = Math.max(columns, column);
      }
    }
    for (const cell of cells.values()) cell.columns = columns;
    return cells;
  }

  function selectionFormatting(text) {
    const selection = getSelection();
    if (!selection?.rangeCount || selection.isCollapsed || text.length > maxChars) return [];
    const range = selection.getRangeAt(0), common = range.commonAncestorContainer;
    const walker = document.createTreeWalker(common, NodeFilter.SHOW_TEXT);
    const nodes = common.nodeType === Node.TEXT_NODE ? [common] : [];
    while (walker.nextNode()) if (range.intersectsNode(walker.currentNode)) nodes.push(walker.currentNode);
    let cursor = 0;
    const spans = [];
    const blocks = [];
    const groups = new Map();
    const visited = new Set();
    const tables = new Map();
    for (const node of nodes) {
      const start = node === range.startContainer ? range.startOffset : 0;
      const end = node === range.endContainer ? range.endOffset : node.length;
      const selected = node.textContent.slice(start, end);
      const pre = node.parentElement?.closest('pre');
      const value = selected.trim();
      if (!value) continue;
      const pattern = new RegExp(value.split(/\s+/).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'), 'g');
      pattern.lastIndex = cursor;
      // In preformatted text prefer an exact match, including indentation.
      const exact = pre ? text.indexOf(selected, cursor) : -1;
      const match = exact >= 0 ? { index: exact, 0: selected } : pattern.exec(text);
      if (!match) continue;
      cursor = match.index + match[0].length;
      const block = node.parentElement?.closest('li,h1,h2,h3,h4,h5,h6,p');
      const quote = node.parentElement?.closest('blockquote');
      const cell = node.parentElement?.closest('td,th');
      const table = cell?.closest('table');
      if (table && !tables.has(table)) tables.set(table, tableLayout(table));
      const cellLayout = tables.get(table)?.get(cell);
      // Paragraphs inside an item belong to that item, including its marker.
      const owner = cellLayout ? cell : pre || (quote && (!block || block.matches('p')) ? quote : (block?.matches('p') ? block.closest('li') || block : block));
      if (owner) {
        let entry = blocks.at(-1);
        if (entry?.owner !== owner) {
          const list = owner.matches('li') ? owner.parentElement : null;
          const type = cellLayout ? 'cell' : pre ? 'pre' : owner.matches('blockquote') ? 'quote' : list?.matches('ol') ? 'ol' : list?.matches('ul') ? 'ul' : /^H[1-6]$/.test(owner.tagName) ? 'heading' : 'paragraph';
          if (cellLayout && !groups.has(table)) groups.set(table, groups.size);
          let depth = 0, number = 1;
          if (type === 'ol' || type === 'ul') {
            for (let ancestor = list.parentElement?.closest('ol,ul'); ancestor; ancestor = ancestor.parentElement?.closest('ol,ul')) depth++;
            if (!groups.has(list)) groups.set(list, groups.size);
            if (type === 'ol') {
              const items = [...list.children].filter(item => item.matches('li'));
              number = list.hasAttribute('start') ? list.start : list.reversed ? items.length : 1;
              for (const item of items) {
                if (item.hasAttribute('value')) number = item.value;
                if (item === owner) break;
                number += list.reversed ? -1 : 1;
              }
            }
          }
          entry = { owner, start: match.index, end: cursor, style: 'block', block: {
            type: visited.has(owner) ? 'paragraph' : type, depth: Math.min(depth, 6),
            group: groups.get(cellLayout ? table : list) ?? 0, number,
            ...(type === 'quote' ? { boxed: owner.getAttribute('data-ke-style') === 'style3' } : {}),
            ...(cellLayout ? cellLayout : {})
          } };
          visited.add(owner);
          blocks.push(entry);
        } else entry.end = cursor;
      }
      for (const [selector, style] of [['strong,b', 'strong'], ['em,i', 'em'], ['code', 'code']]) {
        if ((!pre || cellLayout) && node.parentElement?.closest(selector)) spans.push({ start: match.index, end: cursor, style });
      }
    }
    // Avoid preserving only half of a long selection's structure.
    if (blocks.length + spans.length > 128) return spans.slice(0, 128);
    return [...spans, ...blocks.map(({ owner, ...span }) => span)];
  }

  // The range end is in document order even when the user drags backwards.
  function selectionAnchor() {
    const selection = window.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) return null;
    const range = selection.getRangeAt(0);
    let node = range.endContainer;
    if (node.nodeType === Node.ELEMENT_NODE && range.endOffset > 0) {
      node = node.childNodes[range.endOffset - 1];
      while (node.lastChild) node = node.lastChild;
    } else if (range.endOffset === 0) {
      while (node && node !== document.body && !node.previousSibling) node = node.parentNode;
      if (node?.previousSibling) {
        node = node.previousSibling;
        while (node.lastChild) node = node.lastChild;
      }
    }
    return findBlock(node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement);
  }

  function findBlock(element) {
    for (let node = element; node && node !== document.body; node = node.parentElement) {
      if (node === host || node === iconHost || node.getRootNode() === root) return null;
      if (/^(block|flow-root|list-item|table-cell|table-caption|flex|grid)$/.test(getComputedStyle(node).display)) return node;
    }
    return document.body;
  }

  function placePanel(anchor) {
    ensureUI();
    anchor = anchor?.isConnected && anchor !== host ? anchor : document.body;
    // Highlighted code can be display:block inside a pre. Escape the entire pre
    // or table so the result cannot enlarge a code scroller or a table cell.
    let container = anchor.closest('pre, table');
    while (container) { anchor = container; container = container.parentElement?.closest('pre, table'); }
    // A block can itself be a link, or live inside one. Keep the entire result
    // outside clickable ancestors, including when flex/grid placement appends it.
    const clickable = 'a[href], button, label, [role="link"], [role="button"]';
    while (anchor !== document.body) {
      const container = anchor.closest(clickable);
      if (!container) break;
      anchor = findBlock(container.parentElement) || document.body;
    }
    // Stay inside list items. In a row or grid, append to the text block
    // instead of creating a new layout column or changing list numbering.
    const parentDisplay = anchor.parentElement && getComputedStyle(anchor.parentElement).display;
    const inside = !anchor.matches('pre, table') && (anchor === document.body || anchor.matches('li, dt, dd, figcaption') ||
      /^(flex|inline-flex|grid|inline-grid)$/.test(parentDisplay));
    if (inside) {
      if (host.parentNode !== anchor || host !== anchor.lastChild) anchor.append(host);
    } else if (anchor.nextSibling !== host) {
      anchor.after(host);
    }
    panel.hidden = false;
    // Code and table surfaces can have their own background. The result now
    // lives outside them, so sample its surrounding surface instead.
    watchTheme(anchor.matches('pre, table') ? host.parentElement : anchor);
    widenPanel();
  }

  function widenPanel() {
    if (!host?.isConnected) return;
    const rect = host.getBoundingClientRect();
    const left = Math.max(0, Math.min(4, rect.left - 8));
    const right = Math.max(0, Math.min(4, innerWidth - rect.right - 8));
    panel.style.width = `calc(100% + ${left + right}px)`;
    panel.style.marginLeft = `-${left}px`;
  }

  function hideSelectionButton() {
    pendingSelection = null;
    if (selectionButton) selectionButton.hidden = true;
  }

  function positionSelectionButton() {
    if (!pendingSelection || !selectionButton) return;
    const selection = window.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) { hideSelectionButton(); return; }
    const rects = [...selection.getRangeAt(0).getClientRects()].filter(rect => rect.width && rect.height);
    const rect = rects.at(-1);
    if (!rect || rect.bottom < 0 || rect.top > innerHeight || rect.right < 0 || rect.left > innerWidth) {
      selectionButton.hidden = true;
      return;
    }
    selectionButton.style.left = Math.max(6, Math.min(rect.right - 18, innerWidth - 42)) + 'px';
    selectionButton.style.top = Math.max(6, Math.min(rect.bottom + 5, innerHeight - 42)) + 'px';
    selectionButton.hidden = false;
  }

  function scheduleSelection(event) {
    if (event && (event.composedPath().includes(host) || event.composedPath().includes(iconHost))) return;
    clearTimeout(timer);
    if (!settings.selectionEnabled || pointerDown) return;
    timer = setTimeout(() => {
      const text = selectionText();
      if (!text) { hideSelectionButton(); return; }
      ensureUI();
      pendingSelection = { text, anchor: selectionAnchor(), codeTerms: selectionCodeTerms(), formatting: selectionFormatting(text), themeSamples: globalThis.DRAGIT_CHAMELEON.captureSelection() };
      positionSelectionButton();
    }, 150);
  }

  async function translate(text, label, note = '', anchor = selectionAnchor(), codeTerms = selectionCodeTerms(), formatting = selectionFormatting(text), samples = globalThis.DRAGIT_CHAMELEON.captureSelection()) {
    text = text.trim();
    if (!text) return;
    clearTimeout(timer);
    cancelActive();
    const version = sequence;
    hideSelectionButton();
    lastPayload = [text, label, note, anchor, codeTerms, formatting, samples];
    themeSamples = samples;
    resultCodeTerms = codeTerms;
    resultFormatting = [];
    placePanel(anchor);
    renderResult('');
    retry.hidden = true;
    status.hidden = false;
    if (text.length > maxChars) {
      status.textContent = `한 번에 ${maxChars.toLocaleString()}자까지 번역합니다. 더 짧게 드래그해주세요.`;
      return;
    }
    status.textContent = '번역 중…';
    try {
      // randomUUID is unavailable on HTTP pages; getRandomValues works there too.
      const requestId = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
      activeRequest = requestId;
      const response = await globalThis.DRAGIT_RUNTIME.send({ type: 'TRANSLATE_TEXT', text, requestId, formatting: settings.resultFormatEnabled === true ? formatting : [] });
      if (version !== sequence) return;
      if (!response?.success) throw new Error(response?.error || '번역 응답을 받지 못했습니다. 다시 시도해주세요.');
      resultFormatting = response.formatting || [];
      renderResult(response.translation);
      status.textContent = note;
      status.hidden = !note;
    } catch (error) {
      if (version !== sequence) return;
      status.textContent = /Extension context invalidated/i.test(error.message)
        ? '확장 프로그램이 업데이트되었습니다. 페이지를 새로고침해주세요.' : error.message;
      retry.hidden = false;
    } finally {
      if (version === sequence) activeRequest = null;
    }
  }

  // Explicit, bounded screen snapshot. No observers or background queue.
  function visibleText() {
    const blocks = [];
    let length = 0, truncated = false, previousBlock = null, anchor = null;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          if (node === host || node === iconHost || node.matches('script, style, noscript, svg, canvas, iframe, [hidden], [aria-hidden="true"], ' + editable)) return NodeFilter.FILTER_REJECT;
          const css = getComputedStyle(node);
          return css.display === 'none' || css.visibility === 'hidden' || css.opacity === '0'
            ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
        }
        return node.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    let node;
    while ((node = walker.nextNode())) {
      const range = document.createRange();
      range.selectNodeContents(node);
      if (![...range.getClientRects()].some(r => r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth)) continue;
      const text = node.textContent.replace(/\s+/g, ' ').trim();
      anchor = findBlock(node.parentElement);
      if (length + text.length + 2 > maxChars) {
        const remaining = maxChars - length - 2;
        if (remaining > 0) blocks.push(text.slice(0, remaining).replace(/[\uD800-\uDBFF]$/, ''));
        truncated = true;
        break;
      }
      const block = node.parentElement.closest('p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, td, div, section, article');
      if (block === previousBlock && blocks.length) blocks[blocks.length - 1] += ' ' + text;
      else blocks.push(text);
      previousBlock = block;
      length += text.length + 2;
    }
    return { text: blocks.join('\n\n'), truncated, anchor };
  }

  function translateCurrent() {
    const selection = selectionText();
    if (selection) { translate(selection, '선택한 글'); return; }
    const { text, truncated, anchor } = visibleText();
    if (text) translate(text, '현재 화면', truncated ? '길이 제한으로 일부만 포함' : '', anchor);
    else {
      cancelActive();
      placePanel(document.body);
      renderResult('');
      retry.hidden = true;
      status.hidden = false;
      status.textContent = '현재 화면에 번역할 글이 없습니다. 원하는 글을 드래그해주세요.';
    }
  }

  document.addEventListener('pointerdown', event => {
    if (event.composedPath().includes(host) || event.composedPath().includes(iconHost)) return;
    pointerDown = true;
    hideSelectionButton();
    clearTimeout(timer);
  }, true);
  document.addEventListener('pointerup', event => {
    pointerDown = false;
    scheduleSelection(event);
  }, true);
  document.addEventListener('pointercancel', () => { pointerDown = false; });
  document.addEventListener('selectionchange', scheduleSelection);
  document.addEventListener('keyup', event => {
    if (event.key === 'Escape') closePanel();
    else scheduleSelection(event);
  });
  window.addEventListener('blur', () => { pointerDown = false; clearTimeout(timer); });
  document.addEventListener('scroll', positionSelectionButton, { capture: true, passive: true });
  window.addEventListener('resize', () => { positionSelectionButton(); widenPanel(); scheduleTheme(); });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'TRANSLATE_CURRENT') {
      translateCurrent();
      sendResponse({ success: true });
    } else if (message.type === 'CLOSE_TRANSLATION') {
      closePanel();
      sendResponse({ success: true });
    } else if (message.type === 'GET_PAGE_STATUS') {
      sendResponse({ selectionEnabled: settings.selectionEnabled, inFlight: !!activeRequest });
    }
  });

  async function loadSettings() {
    const data = await chrome.storage.local.get(settingKeys);
    settings = { ...settings, ...data };
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !settingKeys.some(key => key in changes)) return;
    if (Object.keys(changes).filter(key => settingKeys.includes(key)).every(key => ['chameleonEnabled', 'resultFormatEnabled', 'resultFontFamily', 'resultFontSize'].includes(key))) {
      for (const key of ['chameleonEnabled', 'resultFormatEnabled', 'resultFontFamily', 'resultFontSize']) if (changes[key]) settings[key] = changes[key].newValue;
      if (host?.isConnected) { watchTheme(themeAnchor); renderResult(); }
      return;
    }
    closePanel();
    loadSettings().catch(() => {});
  });
  loadSettings().then(ensureUI).catch(() => {});
})();
