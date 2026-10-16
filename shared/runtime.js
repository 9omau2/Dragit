// Bound extension messaging independently of the API request timeout.
globalThis.DRAGIT_RUNTIME = Object.freeze({
  async cancel(requestId) {
    try {
      await globalThis.chrome?.runtime?.sendMessage({ type: 'CANCEL_TRANSLATION', requestId });
    } catch { /* A closed or reloaded extension has nothing left to cancel. */ }
  },
  async send(message) {
    let timer;
    try {
      const runtime = globalThis.chrome?.runtime;
      if (typeof runtime?.sendMessage !== 'function') throw new Error('Extension context invalidated');
      return await Promise.race([
        runtime.sendMessage(message),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            if (message.requestId) void this.cancel(message.requestId);
            reject(new Error('확장 프로그램에서 30초 동안 응답이 없습니다. 확장 프로그램을 새로고침한 뒤 웹페이지와 설정 창을 다시 열어주세요.'));
          }, 30000);
        })
      ]);
    } catch (error) {
      if (/Extension context invalidated/i.test(error?.message || '')) {
        throw new Error('확장 프로그램 연결이 끊겼습니다. 웹페이지를 새로고침하고 설정 창을 다시 열어주세요.');
      }
      if (/receiving end does not exist|could not establish connection|message (?:port|channel) closed/i.test(error?.message || '')) {
        throw new Error('확장 프로그램과 연결하지 못했습니다. 확장 프로그램을 새로고침한 뒤 웹페이지와 설정 창을 다시 열어주세요.');
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
});
