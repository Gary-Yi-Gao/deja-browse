import { dbClient } from '../db/db-client.js';
import { config } from '../lib/config.js';
import { LLMProvider } from '../lib/llm-provider.js';
import { SearchEngine } from '../lib/search.js';
import { escapeXml, truncate, normalizeUrl } from '../lib/utils.js';

let llmProvider = null;
let searchEngine = null;
let retryAlarmName = 'retry-embeddings';
let initPromise = null;

async function initLLMProvider() {
  const cfg = await config.getAll();
  llmProvider = LLMProvider.create(cfg);
  if (searchEngine) {
    searchEngine.updateProvider(llmProvider);
  } else {
    searchEngine = new SearchEngine(dbClient, llmProvider);
  }
}

async function init() {
  let dbReady = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await dbClient.init();
      console.log('[SW] DB init OK');
      dbReady = true;
      break;
    } catch (e) {
      console.error(`[SW] DB init attempt ${attempt + 1} failed:`, e);
      if (attempt < 2) await new Promise(r => setTimeout(r, 1000));
    }
  }
  if (!dbReady) {
    throw new Error('DB init failed after retries');
  }

  await initLLMProvider();

  chrome.alarms.create(retryAlarmName, { periodInMinutes: 30 });

  try {
    chrome.contextMenus.create({
      id: 'deja-collect',
      title: '收录此页到拾迹',
      contexts: ['page'],
    });
  } catch { /* already exists */ }
}

async function ensureInit() {
  if (!initPromise) {
    initPromise = init().catch((err) => {
      // Allow next call to retry full init instead of being stuck on a rejected promise.
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

chrome.runtime.onInstalled.addListener(async (details) => {
  try {
    await ensureInit();
  } catch (e) {
    console.error('[SW] onInstalled ensureInit failed:', e);
    return;
  }
  injectIntoExistingTabs();

  if (details.reason === 'install') {
    chrome.runtime.openOptionsPage();
  }
});

chrome.runtime.onStartup.addListener(() => {
  ensureInit().catch((e) => {
    console.error('[SW] onStartup ensureInit failed:', e);
  });
  injectIntoExistingTabs();
});

async function injectIntoExistingTabs() {
  try {
    const manifest = chrome.runtime.getManifest();
    const csFiles = manifest.content_scripts?.[0]?.js;
    if (!csFiles?.length) return;

    const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
    const validTabs = tabs.filter(t => t.id && t.id !== chrome.tabs.TAB_ID_NONE);

    const BATCH = 3;
    const DELAY = 1000;
    for (let i = 0; i < validTabs.length; i += BATCH) {
      const batch = validTabs.slice(i, i + BATCH);
      for (const tab of batch) {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: csFiles,
        }).catch(() => {});
      }
      if (i + BATCH < validTabs.length) {
        await new Promise(r => setTimeout(r, DELAY));
      }
    }
  } catch (e) {
    console.warn('[SW] injectIntoExistingTabs error:', e);
  }
}

config.onChange(async (changes) => {
  if (changes.provider || changes.openai || changes.zai ||
      changes['openai.apiKey'] || changes['zai.apiKey']) {
    await initLLMProvider();
  }
});

function safeAsync(fn, sendResponse) {
  fn().then(
    result => sendResponse(result),
    err => {
      console.error('[SW] message handler error:', err);
      sendResponse(null);
    },
  );
  return true;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target === 'offscreen' || msg.target === 'db-client' || msg.target === 'offscreen-ready') return;

  if (msg.type === 'CHECK_INCOGNITO') {
    sendResponse({ incognito: sender.tab?.incognito === true });
    return;
  }

  if (msg.type === 'GET_COLLECT_STATUS') {
    sendResponse(getCollectStatus());
    return;
  }

  if (msg.type === 'PAGE_COLLECTED') {
    safeAsync(
      () => ensureInit().then(() => handlePageCollected(msg.data, sender.tab)).then(() => ({ ok: true })),
      sendResponse,
    );
    return true;
  }

  if (msg.type === 'SEARCH') {
    return safeAsync(() => ensureInit().then(() => handleSearch(msg.query)), sendResponse);
  }

  if (msg.type === 'FULL_SEARCH') {
    return safeAsync(() => ensureInit().then(() => handleFullSearch(msg.query)), sendResponse);
  }

  if (msg.type === 'GET_STATS') {
    return safeAsync(() => ensureInit().then(() => dbClient.getStats()), sendResponse);
  }

  if (msg.type === 'TEST_CONNECTION') {
    return safeAsync(() => testConnection(), sendResponse);
  }

  if (msg.type === 'GET_PAGE_STATUS') {
    return safeAsync(
      () => ensureInit().then(() => dbClient.pageExists(normalizeUrl(msg.url))).then(exists => ({ exists })),
      sendResponse,
    );
  }

  if (msg.type === 'DELETE_PAGE') {
    return safeAsync(() => ensureInit().then(() => dbClient.deletePage(msg.url)), sendResponse);
  }

  if (msg.type === 'EXPORT_DB') {
    return safeAsync(() => ensureInit().then(() => dbClient.exportDatabase()), sendResponse);
  }

  if (msg.type === 'IMPORT_DB') {
    return safeAsync(() => ensureInit().then(() => dbClient.importDatabase(msg.bytes, msg.format, msg.strategy)), sendResponse);
  }

  if (msg.type === 'GET_ALL_PAGES') {
    return safeAsync(() => ensureInit().then(() => dbClient.getAllPages(msg.limit || 100000, msg.offset || 0)), sendResponse);
  }
});

const collectQueue = [];
let collectRunning = false;
let currentCollectItem = null;
let collectCompleted = 0;
let collectFailed = 0;
let collectLastError = '';

function getCollectStatus() {
  return {
    running: collectRunning,
    queueLength: collectQueue.length,
    current: currentCollectItem ? { url: currentCollectItem.url, title: currentCollectItem.title } : null,
    completed: collectCompleted,
    failed: collectFailed,
    lastError: collectLastError,
  };
}

async function handlePageCollected(data, tab) {
  collectQueue.push({ data, tab });
  updateCollectBadge();
  if (!collectRunning) processCollectQueue();
}

function updateCollectBadge() {
  const total = collectQueue.length + (collectRunning ? 1 : 0);
  if (total > 0) {
    chrome.action.setBadgeText({ text: String(total) });
    chrome.action.setBadgeBackgroundColor({ color: '#6366f1' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

async function processCollectQueue() {
  if (collectRunning || collectQueue.length === 0) return;
  collectRunning = true;

  while (collectQueue.length > 0) {
    const { data, tab } = collectQueue.shift();
    currentCollectItem = { url: data.url, title: data.title };
    updateCollectBadge();

    try {
      const exists = await dbClient.pageExists(data.url);
      if (exists) {
        collectCompleted++;
        continue;
      }

      const page = {
        url: data.url,
        title: data.title,
        keywords: data.keywords,
        contentSnippet: data.contentSnippet,
        vector: null,
        vectorNorm: null,
        embeddingDim: null,
        provider: null,
        createdAt: Date.now(),
      };

      await dbClient.insertPage(page);
      collectCompleted++;
      collectLastError = '';

      if (tab?.id) {
        updateBadge(tab.id, '✓');
      }

      if (llmProvider?.isConfigured) {
        try {
          const vector = await llmProvider.createEmbedding(data.textContent || data.contentSnippet);
          await dbClient.updateVector(data.url, vector, llmProvider.embeddingDim, llmProvider.provider);
        } catch (e) {
          console.warn('[SW] Embedding failed, queuing for retry:', e.message);
          await addToRetryQueue(data);
          collectLastError = `向量化失败: ${e.message}`;
          if (tab?.id) updateBadge(tab.id, '!');
        }
      }
    } catch (e) {
      console.error('[SW] Page collection error:', e);
      collectFailed++;
      collectLastError = e.message || String(e);
    }
  }

  currentCollectItem = null;
  collectRunning = false;
  updateCollectBadge();
}

async function handleSearch(query) {
  return searchEngine.textSearch(query, 6);
}

async function handleFullSearch(query) {
  return searchEngine.fullSearch(query, 10);
}

async function testConnection() {
  await initLLMProvider();
  return llmProvider.testConnection();
}

function updateBadge(tabId, text) {
  chrome.action.setBadgeText({ text, tabId });
  chrome.action.setBadgeBackgroundColor({
    color: text === '✓' ? '#4CAF50' : '#FF9800',
    tabId,
  });
}

// --- Omnibox ---

let omniboxQuerySeq = 0;

chrome.omnibox.setDefaultSuggestion({
  description: '搜索拾迹浏览记忆…',
});

chrome.omnibox.onInputChanged.addListener(async (text, suggest) => {
  const query = text.trim();
  if (!query) {
    suggest([]);
    return;
  }

  const seq = ++omniboxQuerySeq;
  try {
    await ensureInit();

    const textResults = await searchEngine.textSearch(query, 6);
    if (seq !== omniboxQuerySeq) return;

    if (textResults?.length) {
      suggest(formatSuggestions(textResults));
      return;
    }

    // Text layer may miss Chinese/semantic intent; fallback to full search.
    const fullResults = await searchEngine.fullSearch(query, 6);
    if (seq !== omniboxQuerySeq) return;

    if (fullResults?.length) {
      suggest(formatSuggestions(fullResults));
    } else {
      suggest([{
        content: query,
        description: '<dim>未找到匹配结果，按回车可使用网络搜索</dim>',
      }]);
    }
  } catch (e) {
    console.warn('[SW] omnibox search failed:', e?.message || e);
    suggest([{
      content: query,
      description: '<dim>搜索暂时不可用，按回车可使用网络搜索</dim>',
    }]);
  }
});

function openUrlByDisposition(url, disposition) {
  switch (disposition) {
    case 'currentTab':
      chrome.tabs.update({ url });
      break;
    case 'newForegroundTab':
      chrome.tabs.create({ url });
      break;
    case 'newBackgroundTab':
      chrome.tabs.create({ url, active: false });
      break;
  }
}

chrome.omnibox.onInputEntered.addListener((text, disposition) => {
  const input = text.trim();
  if (!input) return;

  (async () => {
    // 1) If user selected a suggestion, `input` is already a URL.
    try {
      const asUrl = new URL(input);
      openUrlByDisposition(asUrl.toString(), disposition);
      return;
    } catch { /* not url */ }

    // 2) Try plugin search result first for plain query input.
    try {
      await ensureInit();
      const results = await searchEngine.fullSearch(input, 1);
      if (results?.length && results[0]?.url) {
        openUrlByDisposition(results[0].url, disposition);
        return;
      }
    } catch (e) {
      console.warn('[SW] omnibox open top result failed:', e?.message || e);
    }

    // 3) Fallback to web search.
    openUrlByDisposition(`https://www.google.com/search?q=${encodeURIComponent(input)}`, disposition);
  })();
});

function formatSuggestions(results) {
  return results.slice(0, 5).map(r => ({
    content: r.url,
    description: `<match>${escapeXml(r.title)}</match> <dim>- ${escapeXml(truncate(r.summary || r.contentSnippet, 60))}</dim> <url>${escapeXml(r.url)}</url>`,
  }));
}

// --- Context Menu ---

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'deja-collect' && tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: 'MANUAL_COLLECT' }).catch(() => {});
  }
});

// --- Retry Queue ---

async function addToRetryQueue(pageData) {
  const result = await chrome.storage.local.get({ retryQueue: [] });
  const queue = result.retryQueue || [];
  queue.push({
    url: pageData.url,
    textContent: pageData.textContent,
    retryCount: 0,
    lastAttempt: Date.now(),
  });
  await chrome.storage.local.set({ retryQueue: queue });
}

async function processRetryQueue() {
  if (!llmProvider?.isConfigured) return;

  const result = await chrome.storage.local.get({ retryQueue: [] });
  const queue = result.retryQueue || [];
  if (queue.length === 0) return;

  const remaining = [];
  for (const item of queue) {
    if (item.retryCount >= 3) continue;
    try {
      const vector = await llmProvider.createEmbedding(item.textContent);
      await dbClient.updateVector(item.url, vector, llmProvider.embeddingDim, llmProvider.provider);
    } catch {
      item.retryCount++;
      item.lastAttempt = Date.now();
      remaining.push(item);
    }
  }

  await chrome.storage.local.set({ retryQueue: remaining });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === retryAlarmName) {
    processRetryQueue();
  }
});

// --- Tab Status (debounced) ---

let badgeTimer = null;

function debouncedBadgeUpdate(tabId) {
  clearTimeout(badgeTimer);
  badgeTimer = setTimeout(async () => {
    try {
      await ensureInit();
      const tab = await chrome.tabs.get(tabId);
      if (tab.url?.startsWith('http')) {
        const exists = await dbClient.pageExists(tab.url);
        updateBadge(tabId, exists ? '✓' : '');
      }
    } catch { /* ignore */ }
  }, 500);
}

chrome.tabs.onActivated.addListener((activeInfo) => {
  debouncedBadgeUpdate(activeInfo.tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete') {
    debouncedBadgeUpdate(tabId);
  }
});
