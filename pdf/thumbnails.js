export function setupThumbnails(onNavigate) {
  const sidebar = document.getElementById('thumbnails');
  const list = document.getElementById('thumbnail-list');
  const toggle = document.getElementById('toggle-thumbnails');
  let session, activePage = 1;

  function revealCurrent() {
    const button = session?.items[activePage - 1]?.button;
    if (!button || sidebar.hidden) return;
    const box = button.getBoundingClientRect(), bounds = sidebar.getBoundingClientRect();
    if (box.top < bounds.top || box.bottom > bounds.bottom) {
      sidebar.scrollTop += box.top - bounds.top - (sidebar.clientHeight - box.height) / 2;
    }
  }
  function setCurrent(number) {
    if (number === activePage) return;
    session?.items[activePage - 1]?.button.removeAttribute('aria-current');
    activePage = number;
    session?.items[number - 1]?.button.setAttribute('aria-current', 'page');
    revealCurrent();
  }
  async function drain(owner) {
    if (owner.busy || sidebar.hidden || session !== owner) return;
    owner.busy = true;
    try {
      let item;
      while (session === owner && !sidebar.hidden && (item = owner.items.find(i => i.visible && !i.loaded && !i.failed))) {
        try {
          const page = await owner.pdf.getPage(item.number);
          if (session !== owner) return;
          const original = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: Math.min(224 / original.width, 320 / original.height) });
          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
          item.preview.style.aspectRatio = `${viewport.width} / ${viewport.height}`;
          item.preview.style.width = `${viewport.width / 2}px`;
          owner.task = page.render({ canvasContext: canvas.getContext('2d'), viewport });
          await owner.task.promise;
          if (session !== owner) return;
          item.preview.replaceChildren(canvas); item.loaded = true;
        } catch {
          if (session !== owner) return;
          item.failed = true; item.preview.textContent = '—';
        }
        // Bound canvas memory even when scrolling through a large document.
        const loaded = owner.items.filter(i => i.loaded);
        for (const old of loaded.filter(i => !i.visible).slice(0, Math.max(0, loaded.length - 20))) {
          old.preview.replaceChildren(); old.loaded = false;
        }
      }
    } finally { owner.busy = false; }
  }
  function setDocument(pdf) {
    session?.observer.disconnect(); session?.task?.cancel();
    session = null; list.replaceChildren(); sidebar.scrollTop = 0; activePage = 1;
    if (!pdf) return;
    const owner = { pdf, items: [], busy: false };
    session = owner;
    owner.observer = new IntersectionObserver(entries => {
      if (session !== owner) return;
      for (const entry of entries) owner.items[Number(entry.target.dataset.page) - 1].visible = entry.isIntersecting;
      void drain(owner);
    }, { root: sidebar, rootMargin: '200px 0px' });
    for (let number = 1; number <= pdf.numPages; number++) {
      const button = document.createElement('button');
      button.className = 'thumbnail'; button.dataset.page = number;
      button.setAttribute('aria-label', `페이지 ${number}로 이동`);
      if (number === 1) button.setAttribute('aria-current', 'page');
      const preview = document.createElement('span'); preview.className = 'thumbnail-preview'; preview.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span'); label.textContent = number;
      button.append(preview, label); button.addEventListener('click', () => onNavigate(number));
      owner.items.push({ number, button, preview, visible: false, loaded: false });
      list.append(button); owner.observer.observe(button);
    }
  }
  toggle.addEventListener('click', () => {
    sidebar.hidden = !sidebar.hidden;
    toggle.setAttribute('aria-expanded', String(!sidebar.hidden));
    revealCurrent();
    if (session) void drain(session);
  });
  return { setDocument, setCurrent };
}
