import { LRUCache, debounce } from './utils.js';

const embeddingCache = new LRUCache(100);

export class SearchEngine {
  #dbClient;
  #llmProvider;
  #abortController = null;
  #debouncedSemantic;

  constructor(dbClient, llmProvider) {
    this.#dbClient = dbClient;
    this.#llmProvider = llmProvider;
    this.#debouncedSemantic = debounce(
      (query) => this.#semanticSearch(query),
      300,
    );
  }

  updateProvider(llmProvider) {
    this.#llmProvider = llmProvider;
  }

  async textSearch(query, limit = 6) {
    try {
      return await this.#dbClient.searchByText(query, limit);
    } catch (e) {
      console.warn('[Search] FTS error:', e);
      return [];
    }
  }

  async semanticSearch(query) {
    return this.#debouncedSemantic(query);
  }

  async #semanticSearch(query) {
    if (this.#abortController) {
      this.#abortController.abort();
    }
    this.#abortController = new AbortController();

    try {
      if (!this.#llmProvider?.isConfigured) return [];

      let queryVec = embeddingCache.get(query);
      if (!queryVec) {
        queryVec = await this.#llmProvider.createEmbedding(
          query,
          this.#abortController.signal,
        );
        embeddingCache.set(query, queryVec);
      }

      return await this.#dbClient.searchByVector(
        queryVec,
        this.#llmProvider.provider,
        10,
      );
    } catch (e) {
      if (e.name === 'AbortError') return [];
      console.warn('[Search] Semantic error:', e);
      return [];
    }
  }

  async fullSearch(query, limit = 6) {
    const [textResults, semanticResults] = await Promise.all([
      this.textSearch(query, limit),
      this.#semanticSearch(query),
    ]);

    return mergeResults(textResults, semanticResults, limit);
  }

  cancelPending() {
    if (this.#abortController) {
      this.#abortController.abort();
      this.#abortController = null;
    }
  }
}

export function mergeResults(textResults, semanticResults, limit = 6) {
  const seen = new Set();
  const merged = [];

  for (const r of textResults) {
    if (!seen.has(r.url)) {
      seen.add(r.url);
      merged.push({ ...r, source: 'text' });
    }
  }

  for (const r of semanticResults) {
    if (!seen.has(r.url)) {
      seen.add(r.url);
      merged.push({ ...r, source: 'semantic' });
    }
  }

  return merged.slice(0, limit);
}
