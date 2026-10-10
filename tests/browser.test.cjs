const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const base = path.resolve(__dirname, '..');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1120, height: 800 } });
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      const file = path.resolve(base, '.' + url.pathname);
      if (url.hostname !== 'localhost' || !file.startsWith(base + path.sep) || !fs.existsSync(file)) return route.abort();
      return route.fulfill({ body: fs.readFileSync(file), contentType: file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : 'text/html' });
    });
    await context.addInitScript(() => {
      const data = { selectionEnabled: true, geminiApiKey: 'test-key-only', geminiModel: 'gemini-3.5-flash-lite', domainPresets: [{ id: 'dev', name: '개발 문서', description: '기술 문서와 코드', prompt: 'Keep technical terms' }], selectedDomainId: 'dev' };
      const listeners = [], storageListeners = [];
      window.__requests = [];
      window.__pending = [];
      window.__manual = false;
      window.__data = data;
      window.__set = async updates => {
        const changes = {};
        for (const [key, value] of Object.entries(updates)) { changes[key] = { oldValue: data[key], newValue: value }; data[key] = value; }
        storageListeners.forEach(fn => fn(changes, 'local'));
      };
      window.__message = message => new Promise(resolve => listeners.forEach(fn => fn(message, {}, resolve)));
      Object.assign(window.chrome, {
        storage: { local: { get: async keys => Object.fromEntries(keys.filter(key => key in data).map(key => [key, data[key]])), set: window.__set }, onChanged: { addListener: fn => storageListeners.push(fn) } },
        tabs: { query: async () => [{ id: 1 }], sendMessage: async () => { throw new Error('restricted page'); } },
        runtime: {
          getURL: file => 'http://localhost:4173/' + file,
          onMessage: { addListener: fn => listeners.push(fn) },
          sendMessage: (message, callback) => {
            window.__requests.push(message);
            if (message.type === 'CANCEL_TRANSLATION') return Promise.resolve({ success: true });
            const response = { success: true, translation: '선택한 문장만 빠르게 번역합니다. 원문과 함께 비교할 수 있습니다.', usedModel: 'gemini-3.5-flash-lite', result: '안녕 · 123ms' };
            if (callback) { callback(response); return; }
            if (window.__manual) return new Promise(resolve => window.__pending.push(resolve));
            return Promise.resolve(response);
          }
        }
      });
      const original = Element.prototype.attachShadow;
      Element.prototype.attachShadow = function (init) {
        const root = original.call(this, init);
        if (this.id === 'ai-selection-translator') window.__translationRoot = root;
        if (this.id === 'ai-translator-selection-icon') window.__iconRoot = root;
        return root;
      };
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://localhost:4173/tests/fixture.html');
    await page.addScriptTag({ path: path.join(base, 'shared/defaults.js') });
    await page.addScriptTag({ path: path.join(base, 'content/content.js') });
    await page.waitForFunction(() => window.__translationRoot);
    const state = () => page.evaluate(() => ({
      count: __requests.filter(m => m.type === 'TRANSLATE_TEXT').length,
      result: __translationRoot.querySelector('.result').textContent,
      hasSource: !!__translationRoot.querySelector('.source'),
      status: __translationRoot.querySelector('.status').textContent,
      hidden: __translationRoot.querySelector('.panel').hidden
    }));
    const clickIcon = async () => {
      const box = await page.evaluate(() => {
        const button = __iconRoot.querySelector('.selection-button');
        if (button.hidden) return null;
        const rect = button.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      });
      if (box) { await page.mouse.click(box.x, box.y); await page.waitForTimeout(50); }
      return !!box;
    };
    const select = async (selector, click = true) => {
      await page.evaluate(selector => {
        document.activeElement?.blur();
        const node = document.querySelector(selector);
        const range = document.createRange(); range.selectNodeContents(node);
        getSelection().removeAllRanges(); getSelection().addRange(range);
        document.dispatchEvent(new Event('selectionchange'));
      }, selector);
      await page.waitForTimeout(220);
      if (click) await clickIcon();
    };
    assert.equal((await state()).count, 0);
    const originalSecondTop = await page.locator('#second').evaluate(node => node.getBoundingClientRect().top);
    const bounds = await page.locator('#first').evaluate(node => {
      const range = document.createRange(); range.selectNodeContents(node);
      const rect = range.getBoundingClientRect();
      return { left: rect.left, right: rect.right, y: rect.top + rect.height / 2 };
    });
    await page.mouse.move(bounds.left, bounds.y);
    await page.mouse.down();
    await page.mouse.move(bounds.right + 2, bounds.y, { steps: 12 });
    await page.waitForTimeout(300);
    assert.equal((await state()).count, 0, 'Do not translate during a drag');
    await page.mouse.up();
    await page.waitForTimeout(330);
    assert.equal((await state()).count, 0, 'Selecting text must not call the API');
    assert.equal(await clickIcon(), true, 'Translation icon is shown after selection');
    assert.equal((await state()).count, 1);
    assert.match((await state()).result, /선택한 문장/);
    assert.equal((await state()).hasSource, false);
    assert.equal(await page.locator('#first').textContent(), 'Select a sentence to translate it quickly. Keep the original text in view.');
    await select('#first', false);
    assert.equal((await state()).count, 1);
    const inline = await page.evaluate(() => {
      const host = document.querySelector('#ai-selection-translator');
      return { previous: host.previousElementSibling.id, bottom: host.getBoundingClientRect().bottom, nextTop: document.querySelector('#second').getBoundingClientRect().top };
    });
    assert.equal(inline.previous, 'first');
    assert.ok(inline.nextTop >= inline.bottom);
    assert.ok(inline.nextTop > originalSecondTop + 50);
    await page.screenshot({ path: path.join(base, 'tests/selection-preview.png') });
    console.log('PASS icon requires click; inline result pushes following content down without changing original text');
    await page.keyboard.press('Escape');
    assert.equal((await state()).hidden, true);
    assert.equal(await page.locator('#ai-selection-translator').count(), 0);
    assert.ok(Math.abs(await page.locator('#second').evaluate(node => node.getBoundingClientRect().top) - originalSecondTop) < 1);
    await page.evaluate(() => __set({ selectionEnabled: false }));
    await select('#second');
    assert.equal((await state()).count, 1);
    await page.evaluate(() => __set({ selectionEnabled: true }));
    await select('#editable');
    assert.equal((await state()).count, 1);
    console.log('PASS Escape, disabled mode and editable exclusion');
    await page.evaluate(() => { window.__manual = true; });
    await select('#first');
    await select('#second');
    await page.evaluate(() => __pending[1]({ success: true, translation: 'NEW', usedModel: 'test' }));
    await page.waitForTimeout(20);
    await page.evaluate(() => __pending[0]({ success: true, translation: 'OLD', usedModel: 'test' }));
    await page.waitForTimeout(20);
    assert.equal((await state()).result, 'NEW');
    assert.ok(await page.evaluate(() => __requests.some(m => m.type === 'CANCEL_TRANSLATION')));
    console.log('PASS stale response cannot replace the current selection');
    await page.evaluate(() => { __manual = false; getSelection().removeAllRanges(); });
    await page.evaluate(() => __message({ type: 'TRANSLATE_CURRENT' }));
    await page.waitForTimeout(30);
    const screen = await page.evaluate(() => __requests.filter(m => m.type === 'TRANSLATE_TEXT').at(-1).text);
    assert.match(screen, /Select a sentence/);
    assert.ok(!screen.includes('OFFSCREEN SECRET'));
    assert.ok(!screen.includes('HIDDEN SECRET'));
    assert.ok(!screen.includes('EDITABLE SECRET'));
    console.log('PASS explicit viewport snapshot excludes hidden, offscreen and editable text');
    await page.evaluate(() => {
      const p = document.createElement('p'); p.id = 'too-long'; p.textContent = 'x'.repeat(6001); document.body.append(p);
    });
    const before = (await state()).count;
    await select('#too-long', false);
    await page.evaluate(() => __message({ type: 'TRANSLATE_CURRENT' }));
    assert.equal((await state()).count, before);
    assert.match((await state()).status, /6,000/);
    console.log('PASS oversize selection fails without an API request');
    await page.setViewportSize({ width: 390, height: 700 });
    await page.locator('#first').scrollIntoViewIfNeeded();
    await select('#first');
    const mobile = await page.evaluate(() => {
      const rect = __translationRoot.querySelector('.panel').getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: innerWidth };
    });
    assert.ok(mobile.left >= 0 && mobile.right <= mobile.width);
    console.log('PASS narrow-screen panel remains inside viewport');
    await page.setViewportSize({ width: 1120, height: 800 });
    await page.evaluate(() => {
      const cases = document.createElement('div');
      cases.id = 'layout-cases';
      cases.innerHTML = '<ol><li id="list-source">List item to translate</li><li id="list-next">Next list item</li></ol><table><tbody><tr><td id="cell-source">Cell text to translate</td></tr><tr><td id="cell-next">Next cell</td></tr></tbody></table><div style="display:grid;grid-template-columns:1fr 1fr;gap:16px"><p id="grid-source">Grid text to translate</p><p>Other column</p><p id="grid-next">Next grid row</p></div><p id="range-first">Start of a range</p><p id="range-last">End of a range</p><p id="range-next">After the range</p>';
      document.querySelector('#first').before(cases);
    });
    for (const [sourceId, nextId] of [['list-source', 'list-next'], ['cell-source', 'cell-next'], ['grid-source', 'grid-next']]) {
      await page.locator('#' + sourceId).scrollIntoViewIfNeeded();
      await select('#' + sourceId);
      const layout = await page.evaluate(([sourceId, nextId]) => {
        const host = document.querySelector('#ai-selection-translator');
        return { parent: host.parentElement.id, bottom: host.getBoundingClientRect().bottom, nextTop: document.getElementById(nextId).getBoundingClientRect().top };
      }, [sourceId, nextId]);
      assert.equal(layout.parent, sourceId);
      assert.ok(layout.nextTop >= layout.bottom);
    }
    await page.locator('#range-last').scrollIntoViewIfNeeded();
    await page.evaluate(() => {
      const start = document.querySelector('#range-first').firstChild;
      const end = document.querySelector('#range-last').firstChild;
      getSelection().setBaseAndExtent(end, end.length, start, 0);
      document.dispatchEvent(new Event('selectionchange'));
    });
    await page.waitForTimeout(220);
    assert.equal(await clickIcon(), true);
    assert.equal(await page.locator('#ai-selection-translator').evaluate(node => node.previousElementSibling.id), 'range-last');
    // Growing a result must expand normal flow instead of covering the next paragraph.
    const beforeGrowth = await page.locator('#range-next').evaluate(node => node.getBoundingClientRect().top);
    await page.evaluate(() => { __translationRoot.querySelector('.result').textContent = 'Long translation paragraph. '.repeat(160); });
    assert.ok(await page.locator('#range-next').evaluate(node => node.getBoundingClientRect().top) > beforeGrowth + 100);
    console.log('PASS list, table, grid, backwards multi-paragraph selection and long-result reflow');
    const popup = await context.newPage();
    await popup.setViewportSize({ width: 400, height: 600 });
    popup.on('pageerror', error => errors.push(error.message));
    await popup.goto('http://localhost:4173/popup/popup.html');
    await popup.waitForFunction(() => document.querySelector('#main-translate-toggle').checked);
    assert.equal(await popup.locator('h1').textContent(), 'Dragit');
    assert.equal(await popup.locator('.hero-section, .header-status, #active-domain-preview, #btn-deselect-domain').count(), 0);
    assert.equal(await popup.locator('.header #main-translate-toggle').count(), 1);
    await popup.locator('.header .switch').click();
    assert.equal(await popup.evaluate(() => __data.selectionEnabled), false);
    await popup.locator('.header .switch').click();
    assert.equal(await popup.evaluate(() => __data.selectionEnabled), true);
    await popup.locator('#select-active-domain').selectOption('');
    assert.equal(await popup.evaluate(() => __data.selectedDomainId), '');
    await popup.locator('#select-active-domain').selectOption('dev');
    await popup.screenshot({ path: path.join(base, 'tests/popup-main-preview.png') });
    await popup.locator('[data-tab="tab-domain"]').click();
    await popup.locator('#btn-open-add-domain').click();
    assert.match(await popup.locator('label[for="domain-form-name"]').textContent(), /Alias/);
    await popup.locator('#domain-form-name').fill('Casual');
    await popup.locator('#domain-form-prompt').fill('Use natural Korean.');
    await popup.locator('#btn-save-domain').click();
    assert.equal(await popup.evaluate(() => __data.domainPresets.length), 2);
    await popup.locator('.domain-card-item').last().locator('.btn-edit').click();
    assert.equal(await popup.locator('#domain-form-prompt').inputValue(), 'Use natural Korean.');
    await popup.locator('#btn-cancel-domain-modal').click();
    await popup.screenshot({ path: path.join(base, 'tests/popup-context-preview.png') });
    await popup.locator('[data-tab="tab-ai"]').click();
    assert.equal(await popup.locator('#select-gemini-model').inputValue(), 'gemini-3.5-flash-lite');
    await popup.locator('#btn-toggle-key-visibility').click();
    assert.equal(await popup.locator('#input-gemini-key').getAttribute('type'), 'text');
    assert.equal(await popup.locator('#key-eye-slash').getAttribute('hidden'), null);
    await popup.locator('#btn-toggle-key-visibility').click();
    assert.equal(await popup.locator('#input-gemini-key').getAttribute('type'), 'password');
    assert.notEqual(await popup.locator('#key-eye-slash').getAttribute('hidden'), null);
    assert.equal(await popup.locator('.usage-card').count(), 0);
    await popup.locator('#btn-test-gemini-key').click();
    assert.match(await popup.locator('#gemini-test-result').textContent(), /연결 성공/);
    await popup.screenshot({ path: path.join(base, 'tests/popup-preview.png') });
    assert.deepEqual(errors, []);
    console.log('PASS Dragit toggle, context editing, eye icon and API test UI; zero browser errors');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
