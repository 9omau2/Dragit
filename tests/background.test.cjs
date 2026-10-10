const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const base = path.resolve(__dirname, '..');

function worker(initial = {}) {
  const data = { geminiApiKey: 'test-key-only', ...initial };
  let message, installed, changed;
  const calls = [];
  let handler = async () => ({ ok: true, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '안녕하세요' }] } }] }) });
  const context = vm.createContext({
    AbortController, AbortSignal, Date, console,
    fetch: async (url, config) => { calls.push({ url, ...config }); return handler(url, config); },
    chrome: {
      runtime: { id: 'test-extension', onInstalled: { addListener(fn) { installed = fn; } }, onMessage: { addListener(fn) { message = fn; } } },
      storage: {
        local: { get: async () => ({ ...data }), set: async updates => Object.assign(data, updates) },
        onChanged: { addListener(fn) { changed = fn; } }
      }
    }
  });
  vm.runInContext(fs.readFileSync(path.join(base, 'shared/defaults.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(base, 'background/background.js'), 'utf8').replace(/^\uFEFF?import[^\n]*\n/, '').replace(/^import[^\n]*\n/, '').replace('export const DEFAULT_DOMAINS', 'const DEFAULT_DOMAINS'), context);
  const sender = { id: 'test-extension', tab: { id: 1 }, documentId: 'doc-1' };
  return {
    data, calls, installed, changed, setHandler(fn) { handler = fn; },
    send(payload, from = sender) { return new Promise(resolve => message(payload, from, resolve)); }
  };
}

const translate = (text, requestId = 'one') => ({ type: 'TRANSLATE_TEXT', text, requestId });
test('upgrade keeps key and domain settings, migrates legacy default only once', async () => {
  const w = worker({ geminiModel: 'gemini-3.8-flash', selectedDomainId: 'custom', domainPresets: [{ id: 'custom', prompt: 'Use technical terms' }] });
  await w.installed();
  assert.equal(w.data.geminiModel, 'gemini-3.5-flash-lite');
  assert.equal(w.data.geminiApiKey, 'test-key-only');
  assert.equal(w.data.selectedDomainId, 'custom');
  w.data.geminiModel = 'gemini-3.8-flash';
  await w.installed();
  assert.equal(w.data.geminiModel, 'gemini-3.8-flash');
});
test('only selected text sent; minimal thinking and model/language/domain-aware cache', async () => {
  const w = worker({ selectedDomainId: 'dev', domainPresets: [{ id: 'dev', prompt: 'Keep commit' }] });
  assert.equal((await w.send(translate('Hello'))).success, true);
  const body = JSON.parse(w.calls[0].body);
  assert.equal(body.contents[0].parts[0].text, 'Hello');
  assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, 'minimal');
  assert.match(body.systemInstruction.parts[0].text, /Keep commit/);
  assert.equal((await w.send(translate('Hello'))).cached, true);
  assert.equal(w.calls.length, 1);
  w.data.geminiModel = 'gemini-3.1-flash-lite';
  await w.send(translate('Hello'));
  w.data.targetLang = 'ja';
  await w.send(translate('Hello'));
  w.data.domainPresets[0].prompt = 'Other guidance';
  await w.send(translate('Hello'));
  assert.equal(w.calls.length, 4);
});
test('oversize input does not call API', async () => {
  const w = worker();
  assert.equal((await w.send(translate('x'.repeat(6001)))).success, false);
  assert.equal(w.calls.length, 0);
});
test('429 is returned promptly with retry time and no request storm', async () => {
  const w = worker();
  w.setHandler(async () => ({ ok: false, status: 429, json: async () => ({ error: { details: [{ retryDelay: '45s' }] } }) }));
  const result = await w.send(translate('Hello'));
  assert.equal(result.success, false);
  assert.match(result.error, /45초/);
  assert.equal(w.calls.length, 1);
});
test('partial or blocked results never enter cache', async () => {
  const w = worker();
  w.setHandler(async () => ({ ok: true, json: async () => ({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: 'partial' }] } }] }) }));
  assert.equal((await w.send(translate('Hello'))).success, false);
  assert.equal((await w.send(translate('Hello'))).success, false);
  assert.equal(w.calls.length, 2);
});
test('new selection cancels in-flight request; stale cancellation cannot cancel new request', async () => {
  const w = worker();
  let release;
  w.setHandler((url, config) => new Promise((resolve, reject) => {
    config.signal.addEventListener('abort', () => reject(config.signal.reason), { once: true });
    release = () => resolve({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'new result' }] } }] }) });
  }));
  const first = w.send(translate('first', 'first'));
  await new Promise(resolve => setImmediate(resolve));
  const second = w.send(translate('second', 'second'));
  await new Promise(resolve => setImmediate(resolve));
  await w.send({ type: 'CANCEL_TRANSLATION', requestId: 'first' });
  assert.equal(w.calls[1].signal.aborted, false);
  release();
  assert.equal((await first).success, false);
  assert.equal((await second).translation, 'new result');
});
test('missing API key is actionable, and unavailable models do not silently switch', async () => {
  const w = worker({ geminiApiKey: '' });
  assert.match((await w.send(translate('Hello'))).error, /API 키/);
  assert.equal(w.calls.length, 0);
  w.data.geminiApiKey = 'test-key-only';
  w.setHandler(async () => ({ ok: false, status: 404, json: async () => ({ error: { message: 'use models/other-paid-model' } }) }));
  assert.equal((await w.send(translate('Hello'))).success, false);
  assert.equal(w.calls.length, 1);
  assert.equal(w.data.geminiModel, undefined);
});
