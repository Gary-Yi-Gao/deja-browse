const SYNC_DEFAULTS = {
  autoCollectEnabled: true,
  recordMode: 'auto',
  provider: 'zai',
  openai: {
    embeddingModel: 'text-embedding-3-small',
    chatModel: 'gpt-5.4',
    baseUrl: 'https://api.openai.com/v1',
  },
  zai: {
    plan: 'payg',
    embeddingModel: 'embedding-3',
    chatModel: 'glm-5',
  },
  blacklist: {
    custom: [],
    builtinEnabled: true,
  },
  maxContentLength: 2000,
};

const LOCAL_DEFAULTS = {
  'openai.apiKey': '',
  'zai.apiKey': '',
};

class Config {
  #cache = null;
  #listeners = new Set();

  constructor() {
    chrome.storage.onChanged.addListener((changes, area) => {
      this.#cache = null;
      this.#listeners.forEach(fn => fn(changes, area));
    });
  }

  async getAll() {
    if (this.#cache) return this.#cache;

    const [syncData, localData] = await Promise.all([
      chrome.storage.sync.get(SYNC_DEFAULTS),
      chrome.storage.local.get(LOCAL_DEFAULTS),
    ]);

    this.#cache = { ...syncData, ...localData };
    return this.#cache;
  }

  async get(key) {
    const all = await this.getAll();
    return all[key];
  }

  async setSync(data) {
    await chrome.storage.sync.set(data);
    this.#cache = null;
  }

  async setLocal(data) {
    await chrome.storage.local.set(data);
    this.#cache = null;
  }

  onChange(fn) {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }
}

export const config = new Config();
export { SYNC_DEFAULTS, LOCAL_DEFAULTS };
