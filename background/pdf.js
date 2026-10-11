// The built-in PDF reader cannot host content scripts. Open opt-in PDF URLs
// in our packaged reader; fetches inside the reader are not tab navigations.
export function isPdfUrl(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:', 'file:'].includes(url.protocol) && /\.pdf$/i.test(decodeURIComponent(url.pathname));
  } catch { return false; }
}

export async function openPdfTab(tabId, change, tab) {
  if (!change.url && change.status !== 'loading') return;
  const source = change.url || tab.url;
  if (!isPdfUrl(source)) return;
  try {
    const settings = await chrome.storage.local.get(['pdfViewerEnabled']);
    if (!settings.pdfViewerEnabled) return;
    const current = await chrome.tabs.get(tabId);
    if ((current.pendingUrl || current.url) !== source) return;
    const viewer = new URL(chrome.runtime.getURL('pdf/viewer.html'));
    viewer.searchParams.set('file', source);
    await chrome.tabs.update(tabId, { url: viewer.href });
  } catch { /* A closed tab or unavailable file permission needs no retry. */ }
}

chrome.tabs.onUpdated.addListener(openPdfTab);
