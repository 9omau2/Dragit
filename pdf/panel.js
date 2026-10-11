// Panel geometry is independent of PDF rendering and translation state.
export async function setupPanel() {
  const workspace = document.querySelector('.workspace');
  const panel = document.getElementById('translation');
  const divider = document.getElementById('panel-divider');
  const toggle = document.getElementById('toggle-panel');
  const collapse = document.getElementById('collapse-panel');
  const position = document.getElementById('panel-position');
  const { pdfPanelPreferences: saved = {} } = await chrome.storage.local.get(['pdfPanelPreferences']);
  const prefs = {
    position: ['right', 'bottom'].includes(saved?.position) ? saved.position : 'right',
    width: Number.isFinite(saved?.width) ? saved.width : 324,
    height: Number.isFinite(saved?.height) ? saved.height : 240,
    collapsed: saved?.collapsed === true,
  };
  let drag = null, saving = Promise.resolve();
  const compact = () => workspace.clientWidth <= 700;
  const effectivePosition = () => compact() ? 'bottom' : prefs.position;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  function limits() {
    const bottom = effectivePosition() === 'bottom';
    const available = bottom ? workspace.clientHeight : workspace.clientWidth;
    const max = Math.max(80, Math.min(available * .7, available - 120));
    return { bottom, min: Math.min(bottom ? 140 : 220, max), max };
  }
  function save() {
    const snapshot = { ...prefs };
    saving = saving.catch(() => {}).then(() => chrome.storage.local.set({ pdfPanelPreferences: snapshot }));
  }
  function apply() {
    const side = effectivePosition();
    const { bottom, min, max } = limits();
    const size = clamp(bottom ? prefs.height : prefs.width, min, max);
    workspace.dataset.panelPosition = side;
    workspace.classList.toggle('panel-collapsed', prefs.collapsed);
    workspace.style.setProperty('--panel-size', `${size}px`);
    panel.hidden = divider.hidden = prefs.collapsed;
    toggle.setAttribute('aria-expanded', String(!prefs.collapsed));
    toggle.title = prefs.collapsed ? 'Result 패널 펼치기' : 'Result 패널 접기';
    toggle.setAttribute('aria-label', toggle.title);
    collapse.setAttribute('aria-expanded', String(!prefs.collapsed));
    position.value = side;
    position.disabled = compact();
    position.title = compact() ? '좁은 화면에서는 아래에 표시합니다.' : '패널 위치';
    const icons = {
      right: 'M9 6l6 6-6 6',
      bottom: 'M6 9l6 6 6-6',
    };
    collapse.querySelector('path').setAttribute('d', icons[side]);
    divider.setAttribute('aria-orientation', bottom ? 'horizontal' : 'vertical');
    divider.setAttribute('aria-valuemin', String(Math.round(min)));
    divider.setAttribute('aria-valuemax', String(Math.round(max)));
    divider.setAttribute('aria-valuenow', String(Math.round(size)));
  }
  function setCollapsed(value) {
    if (prefs.collapsed === value) return;
    prefs.collapsed = value;
    apply(); save();
  }
  toggle.addEventListener('click', () => setCollapsed(!prefs.collapsed));
  collapse.addEventListener('click', () => { setCollapsed(true); toggle.focus(); });
  position.addEventListener('change', () => { prefs.position = position.value; apply(); save(); });
  function setSize(value) {
    const { bottom, min, max } = limits();
    prefs[bottom ? 'height' : 'width'] = clamp(value, min, max);
    apply();
  }
  divider.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, size: Number(divider.getAttribute('aria-valuenow')), side: effectivePosition() };
    divider.setPointerCapture(event.pointerId);
    workspace.classList.add('resizing-panel');
  });
  divider.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    const delta = drag.side === 'bottom' ? drag.y - event.clientY : drag.x - event.clientX;
    setSize(drag.size + delta);
  });
  function finishDrag() {
    if (!drag) return;
    drag = null; workspace.classList.remove('resizing-panel'); save();
    workspace.dispatchEvent(new Event('panel-resize-end'));
  }
  divider.addEventListener('pointerup', finishDrag);
  divider.addEventListener('pointercancel', finishDrag);
  divider.addEventListener('lostpointercapture', finishDrag);
  window.addEventListener('blur', finishDrag);
  divider.addEventListener('keydown', event => {
    const side = effectivePosition();
    const signs = side === 'bottom' ? { ArrowUp: 1, ArrowDown: -1 } : { ArrowLeft: 1, ArrowRight: -1 };
    if (!signs[event.key]) return;
    event.preventDefault();
    setSize(Number(divider.getAttribute('aria-valuenow')) + signs[event.key] * (event.shiftKey ? 40 : 10));
    save();
  });
  new ResizeObserver(apply).observe(workspace);
  apply();
  return { show: () => setCollapsed(false), isResizing: () => drag !== null };
}
