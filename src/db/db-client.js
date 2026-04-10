const OFFSCREEN_URL = 'src/offscreen/offscreen.html';

let offscreenReady = false;
let msgId = 0;
const pending = new Map();

let offscreenCreating = null;
let lastResetAt = 0;

async function ensureOffscreen() {
  if (offscreenReady) {
    try {
      const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
      });
      if (existingContexts.length > 0) return;
      offscreenReady = false;
    } catch { /* fallthrough */ }
  }

  // If offscreen already exists (e.g. SW restarted), do not wait for a new
  // offscreen-ready event because that event is emitted only on offscreen load.
  try {
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
    });
    if (existingContexts.length > 0) {
      offscreenReady = true;
      return;
    }
  } catch {
    // fall through to create path
  }

  if (offscreenCreating) {
    await offscreenCreating;
    return;
  }

  offscreenCreating = (async () => {
    const readyPromise = waitForOffscreenReady();
    let created = false;

    try {
      await chrome.offscreen.createDocument({
        url: OFFSCREEN_URL,
        reasons: ['WORKERS'],
        justification: 'SQLite OPFS database access via Web Worker',
      });
      created = true;
    } catch (e) {
      if (!e.message?.includes('Only a single offscreen')) throw e;
    }

    // If we did not create a new doc, an existing one may be stale.
    // In that case do not trust it silently; require ready signal.
    await readyPromise;
    offscreenReady = true;
  })();

  try {
    await offscreenCreating;
  } finally {
    offscreenCreating = null;
  }
}

function waitForOffscreenReady() {
  return new Promise((resolve, reject) => {
    let resolved = false;
    const done = () => {
      if (resolved) return;
      resolved = true;
      chrome.runtime.onMessage.removeListener(listener);
      clearTimeout(fallback);
      resolve();
    };
    const fail = () => {
      if (resolved) return;
      resolved = true;
      chrome.runtime.onMessage.removeListener(listener);
      clearTimeout(fallback);
      reject(new Error('Offscreen ready timeout'));
    };
    const listener = (msg) => {
      if (msg.target === 'offscreen-ready') done();
    };
    chrome.runtime.onMessage.addListener(listener);
    const fallback = setTimeout(fail, 12000);
  });
}

async function resetOffscreenDocument() {
  const now = Date.now();
  if (now - lastResetAt < 2000) return;
  lastResetAt = now;
  offscreenReady = false;
  offscreenCreating = null;
  try {
    await chrome.offscreen.closeDocument();
  } catch {
    // ignore: no offscreen or close unsupported in current state
  }
  // Wait for the old Worker to release OPFS file locks before creating a new one
  await new Promise(r => setTimeout(r, 500));
}

function getActionTimeout(action) {
  if (action === 'init') return 120000;
  if (action === 'getStats') return 60000;
  if (action === 'exportDatabase' || action === 'importDatabase') return 120000;
  return 30000;
}

function sendToOffscreenOnce(action, payload) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`DB operation timeout: ${action}`));
    }, getActionTimeout(action));

    pending.set(id, { resolve, reject, timeout });

    chrome.runtime.sendMessage({
      target: 'offscreen',
      id,
      action,
      payload,
    }).catch((err) => {
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      clearTimeout(timeout);
      reject(err);
    });
  });
}

async function sendToOffscreen(action, payload) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await ensureOffscreen();
      return await sendToOffscreenOnce(action, payload);
    } catch (e) {
      const msg = String(e?.message || e);
      const recoverable = (
        msg.includes('Receiving end does not exist')
        || msg.includes('DB operation timeout')
        || msg.includes('Offscreen ready timeout')
        || msg.includes('CompileError')
        || msg.includes('BufferSource argument is empty')
        || msg.includes('sqlite wasm is empty')
        || msg.includes('sqlite wasm bytes empty')
        || msg.includes('sqlite wasm fetch failed')
        || msg.includes('OPFS Pool VFS init failed')
      );
      if (!recoverable || attempt === 1) throw e;
      await resetOffscreenDocument();
    }
  }
}


chrome.runtime.onMessage.addListener((msg) => {
  if (msg.target !== 'db-client') return;
  const { id, result, error } = msg;
  const entry = pending.get(id);
  if (!entry) return;
  pending.delete(id);
  clearTimeout(entry.timeout);
  if (error) entry.reject(new Error(error));
  else entry.resolve(result);
});

export class DbClient {
  async init() {
    return sendToOffscreen('init');
  }

  async insertPage(page) {
    const payload = {
      page: {
        ...page,
        vector: page.vector ? Array.from(page.vector) : null,
      },
    };
    return sendToOffscreen('insertPage', payload);
  }

  async pageExists(url) {
    return sendToOffscreen('pageExists', { url });
  }

  async searchByText(keyword, limit = 6) {
    return sendToOffscreen('searchByText', { keyword, limit });
  }

  async searchByVector(queryVector, provider, topK = 10) {
    return sendToOffscreen('searchByVector', {
      queryVector: Array.from(queryVector),
      provider,
      topK,
    });
  }

  async updateVector(url, vector, embeddingDim, provider) {
    return sendToOffscreen('updateVector', {
      url,
      vector: Array.from(vector),
      embeddingDim,
      provider,
    });
  }

  async deletePage(url) {
    return sendToOffscreen('deletePage', { url });
  }

  async getStats() {
    return sendToOffscreen('getStats');
  }

  async exportDatabase() {
    return sendToOffscreen('exportDatabase');
  }

  async importDatabase(bytes, format, strategy = 'merge') {
    return sendToOffscreen('importDatabase', {
      bytes: Array.from(bytes),
      format,
      strategy,
    });
  }

  async getAllPages(limit = 1000, offset = 0) {
    return sendToOffscreen('getAllPages', { limit, offset });
  }

  async getPagesWithoutVector(limit = 50) {
    return sendToOffscreen('getPagesWithoutVector', { limit });
  }
}

export const dbClient = new DbClient();
