const worker = new Worker(
  new URL('../db/db-worker.js', import.meta.url),
  { type: 'module' },
);

const pending = new Map();

worker.onmessage = (e) => {
  const { id, result, error } = e.data;
  const entry = pending.get(id);
  if (!entry) return;
  pending.delete(id);

  chrome.runtime.sendMessage({
    target: 'db-client',
    id: entry.originalId,
    result,
    error,
  });
};

worker.onerror = (e) => {
  console.error('[Offscreen] Worker error:', e);
};

let workerMsgId = 0;

chrome.runtime.onMessage.addListener((msg, _sender, _sendResponse) => {
  if (msg.target !== 'offscreen') return;

  const { id, action, payload } = msg;
  const wid = ++workerMsgId;

  pending.set(wid, { originalId: id });

  worker.postMessage({ id: wid, action, payload });
});

chrome.runtime.sendMessage({ target: 'offscreen-ready' }).catch(() => {});
