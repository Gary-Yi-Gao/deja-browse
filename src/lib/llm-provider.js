export class LLMProvider {
  #provider;
  #apiKey;
  #baseUrl;
  #embeddingModel;
  #chatModel;

  constructor({ provider, apiKey, baseUrl, embeddingModel, chatModel }) {
    this.#provider = provider;
    this.#apiKey = apiKey;
    this.#baseUrl = baseUrl;
    this.#embeddingModel = embeddingModel;
    this.#chatModel = chatModel;
  }

  static create(cfg) {
    const providerCfg = cfg[cfg.provider];
    const apiKey = cfg[`${cfg.provider}.apiKey`] || cfg[cfg.provider]?.apiKey;
    return new LLMProvider({
      provider: cfg.provider,
      apiKey,
      baseUrl: LLMProvider.resolveBaseUrl(cfg),
      embeddingModel: providerCfg.embeddingModel,
      chatModel: providerCfg.chatModel,
    });
  }

  static resolveBaseUrl(cfg) {
    if (cfg.provider === 'openai') {
      return cfg.openai.baseUrl || 'https://api.openai.com/v1';
    }
    return cfg.zai?.plan === 'coding'
      ? 'https://api.z.ai/api/coding/paas/v4'
      : 'https://api.z.ai/api/paas/v4';
  }

  get provider() {
    return this.#provider;
  }

  get embeddingDim() {
    if (this.#provider === 'openai') {
      return this.#embeddingModel === 'text-embedding-3-large' ? 3072 : 1536;
    }
    return 1024;
  }

  get isConfigured() {
    return Boolean(this.#apiKey);
  }

  async #fetchWithTimeout(url, options, timeoutMs = 15000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
    if (options?.signal) {
      if (options.signal.aborted) {
        clearTimeout(timer);
        controller.abort(options.signal.reason);
      } else {
        options.signal.addEventListener('abort', () => controller.abort(options.signal.reason), { once: true });
      }
    }
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async createEmbedding(text, signal) {
    if (!this.#apiKey) throw new Error('API Key 未配置');

    const res = await this.#fetchWithTimeout(`${this.#baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.#apiKey}`,
      },
      body: JSON.stringify({
        model: this.#embeddingModel,
        input: text,
      }),
      signal,
    }, 15000);

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Embedding API 错误 (${res.status}): ${body}`);
    }

    const json = await res.json();
    return new Float32Array(json.data[0].embedding);
  }

  async chat(messages, signal) {
    if (!this.#apiKey) throw new Error('API Key 未配置');

    const res = await this.#fetchWithTimeout(`${this.#baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.#apiKey}`,
      },
      body: JSON.stringify({
        model: this.#chatModel,
        messages,
      }),
      signal,
    }, 20000);

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Chat API 错误 (${res.status}): ${body}`);
    }

    const json = await res.json();
    return json.choices[0].message.content;
  }

  async testConnection() {
    try {
      await this.createEmbedding('test');
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
}
