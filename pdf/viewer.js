import { getDocument, GlobalWorkerOptions, normalizeUnicode } from '../vendor/pdfjs/build/pdf.mjs';
import { TextLayerBuilder } from '../vendor/pdfjs/web/text_layer_builder.js';
import { setupPanel } from './panel.js';
import { setupThumbnails } from './thumbnails.js';

GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('vendor/pdfjs/build/pdf.worker.mjs');
const $ = id => document.getElementById(id);
const scroller = $('document'), pages = $('pages'), icon = $('translate-selection');
let settings = await chrome.storage.local.get(['pdfViewerEnabled', 'selectionEnabled', 'resultFormatEnabled', 'resultFontFamily', 'resultFontSize']);
let rawResult = null;
globalThis.DRAGIT_RESULT_FONTS.apply($('result'), settings);
function renderResult() { globalThis.DRAGIT_RESULT_FORMAT($('result'), rawResult, settings.resultFormatEnabled === true); }
let loadingTask, pdf, states = [], observer, generation = 0, rendering = false;
let selectionTimer, selectedText = '', requestId, requestSequence = 0, retryText = '';
let currentPage = 1, initialPage = 1, selecting = false;
let zoomPercent = 100;
const enabled = () => settings.pdfViewerEnabled === true && settings.selectionEnabled !== false;
const resultPanel = await setupPanel();
const thumbnails = setupThumbnails(goToPage);

function notice(text = '') { $('notice').textContent = text; $('notice').hidden = !text; }
function idleResult() {
  rawResult = null;
  $('result').textContent = enabled() ? '글을 드래그하고 번역 아이콘을 누르세요.' : 'Dragit의 번역 설정에서 PDF viewer와 번역 토글을 켜주세요.';
  $('result').className = 'muted';
}
function cancelTranslation() {
  requestSequence++;
  if (requestId) void globalThis.DRAGIT_RUNTIME.cancel(requestId);
  requestId = null;
  $('retry').hidden = true;
  icon.hidden = true;
}
function resetTranslation() { cancelTranslation(); retryText = ''; idleResult(); }
idleResult();
document.addEventListener('keydown', event => { if (event.key === 'Escape') resetTranslation(); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  for (const key of ['pdfViewerEnabled', 'selectionEnabled']) if (changes[key]) settings[key] = changes[key].newValue;
  if (changes.resultFontFamily || changes.resultFontSize) {
    for (const key of ['resultFontFamily', 'resultFontSize']) if (changes[key]) settings[key] = changes[key].newValue;
    globalThis.DRAGIT_RESULT_FONTS.apply($('result'), settings);
  }
  if (changes.resultFormatEnabled) {
    settings.resultFormatEnabled = changes.resultFormatEnabled.newValue === true;
    if (rawResult !== null) renderResult();
  }
  if (['pdfViewerEnabled','selectionEnabled','targetLang','selectedDomainId','domainPresets','geminiApiKey','geminiModel'].some(key => changes[key])) resetTranslation();
});

async function translate(text) {
  if (!enabled() || !text.trim()) return;
  resultPanel.show();
  cancelTranslation();
  rawResult = null;
  retryText = text;
  const sequence = requestSequence;
  $('result').className = '';
  if (text.length > globalThis.AI_TRANSLATOR_DEFAULTS.maxChars) {
    $('result').textContent = '한 번에 6,000자까지 번역할 수 있습니다. 더 짧게 선택해주세요.';
    return;
  }
  $('result').textContent = '번역 중…';
  requestId = crypto.randomUUID();
  try {
    const response = await globalThis.DRAGIT_RUNTIME.send({ type: 'TRANSLATE_TEXT', text, requestId });
    if (sequence !== requestSequence) return;
    if (!response?.success) throw new Error(response?.error || '번역하지 못했습니다. 다시 시도해주세요.');
    rawResult = response.translation;
    renderResult();
  } catch (error) {
    if (sequence !== requestSequence) return;
    $('result').textContent = error.message;
    $('result').className = 'error';
    $('retry').hidden = false;
  } finally { if (sequence === requestSequence) requestId = null; }
}
$('retry').addEventListener('click', () => translate(retryText));
icon.addEventListener('pointerdown', event => event.preventDefault());
icon.addEventListener('click', () => translate(selectedText));
function updateSelection() {
  clearTimeout(selectionTimer);
  icon.hidden = true;
  if (selecting) return;
  selectionTimer = setTimeout(() => {
    const selection = getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) {
      return;
    }
    if (!enabled() || !pages.contains(selection.anchorNode) || !pages.contains(selection.focusNode)) return;
    const text = normalizeUnicode(selection.toString()).replace(/\x00/g, '').trim();
    if (!text) return;
    const range = selection.getRangeAt(0);
    const rects = [...range.getClientRects()].filter(r => r.width && r.height);
    // A selection's focus is the end the user is moving, also for backwards
    // drags and Shift+Arrow. A sorted Range always ends at the bottom instead.
    const caret = document.createRange();
    caret.setStart(selection.focusNode, selection.focusOffset); caret.collapse(true);
    const focusBox = caret.getBoundingClientRect();
    const backwards = selection.focusNode === range.startContainer && selection.focusOffset === range.startOffset;
    const box = focusBox.height ? focusBox : backwards ? rects[0] : rects.at(-1);
    const bounds = scroller.getBoundingClientRect();
    if (!box || box.bottom < bounds.top || box.top > bounds.bottom) return;
    selectedText = text;
    icon.style.left = `${Math.max(bounds.left + 4, Math.min(box.right - 12, bounds.right - 42))}px`;
    icon.style.top = `${Math.max(bounds.top + 4, Math.min(box.bottom + 5, bounds.bottom - 42))}px`;
    icon.hidden = false;
  }, 100);
}
document.addEventListener('selectionchange', updateSelection);
scroller.addEventListener('pointerdown', event => {
  if (event.button !== 0 || !pages.contains(event.target)) return;
  selecting = true; icon.hidden = true; clearTimeout(selectionTimer);
});
document.addEventListener('pointerup', () => { if (selecting) { selecting = false; updateSelection(); } });
function endDrag() { selecting = false; icon.hidden = true; clearTimeout(selectionTimer); }
document.addEventListener('pointercancel', endDrag);
window.addEventListener('blur', endDrag);
scroller.addEventListener('scroll', () => {
  icon.hidden = true;
  const top = scroller.getBoundingClientRect().top;
  const nearest = states.find(s => s.element.getBoundingClientRect().bottom > top + 20);
  if (nearest) { currentPage = nearest.number; thumbnails.setCurrent(currentPage); if (document.activeElement !== $('page-number')) $('page-number').value = currentPage; }
}, { passive: true });

function scaleFor() { return zoomPercent / 100; }
function placeholder(state, viewport) {
  state.element.style.width = `${viewport.width}px`;
  state.element.style.height = `${viewport.height}px`;
  state.element.style.setProperty('--total-scale-factor', viewport.scale);
  const label = document.createElement('span');
  label.className = 'page-placeholder'; label.textContent = state.number;
  state.element.replaceChildren(label);
}

async function draw(state, token) {
  const page = await pdf.getPage(state.number);
  if (token !== generation) return;
  const viewport = page.getViewport({ scale: scaleFor(page) });
  placeholder(state, viewport);
  const canvas = document.createElement('canvas');
  // Bound backing-store memory, even for very large pages and high-DPI screens.
  const ratio = Math.min(devicePixelRatio || 1, 2, Math.sqrt(16000000 / (viewport.width * viewport.height)));
  canvas.width = Math.max(1, Math.floor(viewport.width * ratio));
  canvas.height = Math.max(1, Math.floor(viewport.height * ratio));
  state.element.replaceChildren(canvas);
  state.renderTask = page.render({ canvasContext: canvas.getContext('2d'), viewport, transform: [ratio,0,0,ratio,0,0] });
  await state.renderTask.promise;
  if (token !== generation) return;
  state.textLayer = new TextLayerBuilder({ pdfPage: page });
  state.element.append(state.textLayer.div);
  await state.textLayer.render({ viewport });
  if (token !== generation) return;
  if (!state.textLayer.div.textContent.trim()) {
    const info = document.createElement('span'); info.className = 'page-info';
    info.textContent = '선택 가능한 텍스트가 없는 페이지 · OCR 미지원'; state.element.append(info);
  }
  state.loaded = true;
}

async function drain() {
  if (rendering || !pdf) return;
  rendering = true;
  try {
    let state;
    while ((state = states.find(s => s.visible && !s.loaded && !s.failed))) {
      const token = generation;
      try { await draw(state, token); }
      catch (error) {
        if (token === generation) { state.failed = true; state.element.textContent = `페이지 ${state.number}를 표시하지 못했습니다. 다른 파일로 다시 열어주세요.`; console.warn(error.name); }
      }
      // Keep at most eight rendered pages, plus those currently near the viewport.
      const loaded = states.filter(s => s.loaded);
      for (const old of loaded.filter(s => !s.visible).slice(0, Math.max(0, loaded.length - 8))) {
        const selection = getSelection();
        if (selection?.rangeCount && selection.getRangeAt(0).intersectsNode(old.element)) continue;
        old.textLayer?.cancel(); old.element.replaceChildren(); old.loaded = false;
      }
    }
  } finally { rendering = false; }
}

async function layout() {
  if (!pdf) return;
  const token = ++generation;
  observer?.disconnect();
  states.forEach(s => { s.renderTask?.cancel(); s.textLayer?.cancel(); });
  let first;
  try { first = await pdf.getPage(1); }
  catch { if (token === generation) notice('PDF를 표시하지 못했습니다. Open PDF로 다시 열어주세요.'); return; }
  if (token !== generation) return;
  const viewport = first.getViewport({ scale: scaleFor(first) });
  states = Array.from({ length: pdf.numPages }, (_, i) => {
    const element = document.createElement('div'); element.className = 'pdf-page';
    element.dataset.page = i + 1; element.setAttribute('aria-label', `페이지 ${i + 1}`);
    const state = { element, number: i + 1, visible: false, loaded: false };
    placeholder(state, viewport); return state;
  });
  pages.replaceChildren(...states.map(s => s.element));
  observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const state = states[Number(entry.target.dataset.page) - 1];
      if (state?.element === entry.target) state.visible = entry.isIntersecting;
    }
    void drain();
  }, { root: scroller, rootMargin: '600px 0px' });
  states.forEach(s => observer.observe(s.element));
  goToPage(currentPage);
}
function goToPage(number) {
  currentPage = Math.max(1, Math.min(states.length, Number(number) || 1));
  $('page-number').value = currentPage;
  thumbnails.setCurrent(currentPage);
  const state = states[currentPage - 1];
  if (state) scroller.scrollTop += state.element.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 20;
}
$('page-number').addEventListener('change', event => goToPage(event.target.value));
$('page-number').addEventListener('keydown', event => {
  if (event.key === 'Enter') { event.preventDefault(); goToPage(event.target.value); }
});
const zoomLevels = [25, 50, 75, 100, 125, 150, 175, 200, 250, 300];
function updateZoomButtons() {
  $('zoom-out').disabled = !pdf || zoomPercent <= zoomLevels[0];
  $('zoom-in').disabled = !pdf || zoomPercent >= zoomLevels.at(-1);
}
function changeZoom(value = $('zoom').value) {
  const parsed = Number(String(value).trim().replace(/%$/, ''));
  const next = Number.isFinite(parsed) && parsed > 0 ? Math.max(25, Math.min(300, Math.round(parsed))) : zoomPercent;
  $('zoom').value = String(next);
  if (!pdf || next === zoomPercent) return;
  zoomPercent = next;
  icon.hidden = true; updateZoomButtons(); void layout();
}
$('zoom').addEventListener('change', () => changeZoom());
$('zoom').addEventListener('keydown', event => {
  if (event.key === 'Enter') { event.preventDefault(); changeZoom(); $('zoom').blur(); }
  if (event.key === 'Escape') { event.stopPropagation(); $('zoom').value = String(zoomPercent); $('zoom').blur(); }
});
function stepZoom(direction) {
  if (!pdf) return;
  const next = direction > 0 ? zoomLevels.find(value => value > zoomPercent) : zoomLevels.findLast(value => value < zoomPercent);
  changeZoom(next ?? zoomPercent);
}
$('zoom-out').addEventListener('click', () => stepZoom(-1));
$('zoom-in').addEventListener('click', () => stepZoom(1));

let loadSequence = 0;
async function openDocument(input, name) {
  const sequence = ++loadSequence;
  ++generation; observer?.disconnect();
  states.forEach(s => { s.renderTask?.cancel(); s.textLayer?.cancel(); });
  states = []; pdf = null; pages.replaceChildren(); resetTranslation();
  thumbnails.setDocument(null);
  const oldTask = loadingTask; loadingTask = null;
  if (oldTask) await oldTask.destroy().catch(() => {});
  if (sequence !== loadSequence) return;
  notice('PDF 여는 중…'); $('empty').hidden = true;
  for (const id of ['page-number','zoom','zoom-in','zoom-out']) $(id).disabled = true;
  zoomPercent = 100; $('zoom').value = '100';
  $('page-count').textContent = '/ 0';
  $('filename').textContent = name; document.title = `${name} · Dragit`;
  try {
    if (typeof input === 'string') {
      const url = new URL(input);
      if (!['https:','http:','file:'].includes(url.protocol) || url.username || url.password) throw new Error('http, https 또는 로컬 PDF 파일만 열 수 있습니다.');
      if (url.protocol === 'file:' && !await chrome.extension.isAllowedFileSchemeAccess()) throw new Error('파일 URL 접근 허용을 켜거나, Open PDF에서 파일을 직접 선택해주세요.');
    }
    const source = typeof input === 'string' ? { url: input } : { data: new Uint8Array(await input.arrayBuffer()) };
    if (sequence !== loadSequence) return;
    const task = loadingTask = getDocument({
      ...source,
      cMapUrl: chrome.runtime.getURL('vendor/pdfjs/cmaps/'), cMapPacked: true,
      standardFontDataUrl: chrome.runtime.getURL('vendor/pdfjs/standard_fonts/'),
      wasmUrl: chrome.runtime.getURL('vendor/pdfjs/wasm/'),
      useWorkerFetch: false, isEvalSupported: false,
    });
    task.onPassword = (update, reason) => {
      if (sequence !== loadSequence) return;
      const password = prompt(reason === 2 ? '암호가 틀렸습니다. 다시 입력해주세요.' : 'PDF 암호를 입력해주세요.');
      if (password === null) { void task.destroy(); notice('암호 입력을 취소했습니다. Open PDF로 다시 열어주세요.'); $('empty').hidden = false; }
      else update(password);
    };
    const loaded = await task.promise;
    if (sequence !== loadSequence) { await loaded.destroy(); return; }
    pdf = loaded; currentPage = initialPage; initialPage = 1;
    thumbnails.setDocument(pdf);
    $('page-count').textContent = `/ ${pdf.numPages}`; $('page-number').max = pdf.numPages;
    for (const id of ['page-number','zoom']) $(id).disabled = false;
    updateZoomButtons();
    notice(); await layout();
  } catch (error) {
    if (sequence !== loadSequence) return;
    notice(error.message?.includes('파일 URL') ? error.message : 'PDF를 열지 못했습니다. 주소와 파일을 확인하거나 Open PDF에서 파일을 직접 선택해주세요.');
    $('empty').hidden = false;
  }
}
$('open-file').addEventListener('click', () => $('file-input').click());
$('file-input').addEventListener('change', async event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (file) { history.replaceState(null, '', location.pathname); initialPage = 1; await openDocument(file, file.name); }
});
$('url-form').addEventListener('submit', event => {
  event.preventDefault(); const value = $('pdf-url').value.trim();
  if (value) void openDocument(value, 'PDF');
});
const inputUrl = new URLSearchParams(location.search).get('file');
if (inputUrl) {
  let name = 'PDF';
  try {
    const url = new URL(inputUrl); name = decodeURIComponent(url.pathname.split('/').pop()) || 'PDF';
    initialPage = Math.max(1, Number(new URLSearchParams(url.hash.slice(1)).get('page')) || 1);
  } catch { /* openDocument reports malformed URLs. */ }
  void openDocument(inputUrl, name);
}
addEventListener('pagehide', () => { cancelTranslation(); });
