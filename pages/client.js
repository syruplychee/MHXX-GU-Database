/* global MHXX_ICON_FILES */

function openWorker() {
  const worker = new Worker('pages-worker.js');
  const pending = new Map();
  let nextId = 0;
  let failure;

  function close(reason) {
    worker.terminate();
    failure = reason;
    for (const { reject } of pending.values()) reject(reason);
    pending.clear();
  }

  worker.onmessage = ({ data }) => {
    const reply = pending.get(data.id);
    if (!reply) return;
    pending.delete(data.id);
    if (data.status >= 400) reply.reject(new Error(data.body.error));
    else reply.resolve(data.body);
  };
  worker.onerror = () => close(new Error('无法启动资料库线程，请刷新页面重试。'));
  worker.onmessageerror = () => close(new Error('无法读取资料库线程的结果，请刷新页面重试。'));

  return {
    close,
    query(payload) {
      if (failure) return Promise.reject(failure);
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        worker.postMessage({ id, ...payload });
        pending.set(id, { resolve, reject });
      });
    },
  };
}

let library;

globalThis.mhxxPages = {
  iconFiles: MHXX_ICON_FILES,
  async request(method, url, body, signal) {
    const payload = { method, url, body };
    if (method !== 'POST' || url !== '/api/set/search') {
      library ??= openWorker();
      return library.query(payload);
    }

    signal?.throwIfAborted();
    const search = openWorker();
    const abort = () => search.close(signal.reason);
    signal?.addEventListener('abort', abort, { once: true });
    try {
      return await search.query(payload);
    } finally {
      signal?.removeEventListener('abort', abort);
      search.close();
    }
  },
};
