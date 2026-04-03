import { normalizeUrl, isDomainBlacklisted } from '../lib/utils.js';

if (window.__dejaBrowseInjectedV2 || !window.location.protocol.startsWith('http')) {
  // Already injected or non-HTTP: do nothing
} else {
  window.__dejaBrowseInjectedV2 = true;
  let config = null;
  let collectTimer = null;
  let lastCollectedUrl = null;
  let isIncognito = false;

  async function loadConfig() {
    try {
      config = await chrome.storage.sync.get({
        autoCollectEnabled: true,
        recordMode: 'auto',
        blacklist: { custom: [], builtinEnabled: true },
        maxContentLength: 2000,
      });
    } catch {
      config = {
        autoCollectEnabled: true,
        recordMode: 'auto',
        blacklist: { custom: [], builtinEnabled: true },
        maxContentLength: 2000,
      };
    }
  }

  function shouldSkip() {
    if (isIncognito) return true;
    if (config && isDomainBlacklisted(window.location.href, config.blacklist)) return true;
    return false;
  }

  async function collectPage(force = false) {
    try {
      if (shouldSkip()) return { ok: false, reason: '页面命中黑名单或隐身模式' };

      const url = normalizeUrl(window.location.href);
      if (!force && url === lastCollectedUrl) {
        return { ok: false, reason: '同一页面近期已触发收录' };
      }

      const { extractContent } = await import('../lib/extractor.js');
      const extracted = extractContent(document, config?.maxContentLength || 2000);
      if (!extracted.title && !extracted.textContent) {
        return { ok: false, reason: '页面内容为空或不可提取' };
      }

      const resp = await chrome.runtime.sendMessage({
        type: 'PAGE_COLLECTED',
        data: {
          url,
          title: extracted.title,
          keywords: extracted.keywords,
          contentSnippet: extracted.contentSnippet,
          textContent: extracted.textContent,
        },
      });
      if (!resp?.ok) {
        throw new Error(resp?.error || 'PAGE_COLLECTED rejected');
      }
      lastCollectedUrl = url;
      return { ok: true };
    } catch (e) {
      console.error('[Deja] collectPage error:', e);
      return { ok: false, reason: e.message || '未知错误' };
    }
  }

  function autoCollect(stagger = false) {
    if (config?.autoCollectEnabled === false) return;
    if (config?.recordMode !== 'auto') return;
    clearTimeout(collectTimer);
    const base = 5000;
    const delay = stagger ? base + Math.floor(Math.random() * 10000) : base;
    collectTimer = setTimeout(collectPage, delay);
  }

  function initSpaDetection() {
    let currentUrl = window.location.href;

    window.addEventListener('popstate', () => {
      if (window.location.href !== currentUrl) {
        currentUrl = window.location.href;
        lastCollectedUrl = null;
        autoCollect();
      }
    });

    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function (...args) {
      originalPushState.apply(this, args);
      if (window.location.href !== currentUrl) {
        currentUrl = window.location.href;
        lastCollectedUrl = null;
        autoCollect();
      }
    };

    history.replaceState = function (...args) {
      originalReplaceState.apply(this, args);
      if (window.location.href !== currentUrl) {
        currentUrl = window.location.href;
        lastCollectedUrl = null;
        autoCollect();
      }
    };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'MANUAL_COLLECT') {
      // Ack quickly so popup never gets stuck at "采集中...".
      sendResponse({ ok: true, accepted: true });
      collectPage(true).catch((e) => {
        console.warn('[Deja] MANUAL_COLLECT async error:', e?.message || e);
      });
      return;
    }
    if (msg.type === 'CONFIG_UPDATED') {
      loadConfig();
    }
  });

  async function init() {
    await loadConfig();

    try {
      const resp = await chrome.runtime.sendMessage({ type: 'CHECK_INCOGNITO' });
      isIncognito = resp?.incognito === true;
    } catch { /* ignore */ }

    if (shouldSkip()) return;

    initSpaDetection();

    if (document.readyState === 'complete') {
      autoCollect(true);
    } else {
      window.addEventListener('load', () => autoCollect(), { once: true });
    }
  }

  init();
}
