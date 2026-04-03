export class LRUCache {
  #map = new Map();
  #maxSize;

  constructor(maxSize = 100) {
    this.#maxSize = maxSize;
  }

  get(key) {
    if (!this.#map.has(key)) return undefined;
    const value = this.#map.get(key);
    this.#map.delete(key);
    this.#map.set(key, value);
    return value;
  }

  set(key, value) {
    this.#map.delete(key);
    this.#map.set(key, value);
    if (this.#map.size > this.#maxSize) {
      const oldest = this.#map.keys().next().value;
      this.#map.delete(oldest);
    }
  }

  has(key) {
    return this.#map.has(key);
  }

  clear() {
    this.#map.clear();
  }
}

export function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    return new Promise(resolve => {
      timer = setTimeout(() => resolve(fn(...args)), ms);
    });
  };
}

export function escapeXml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function truncate(str, maxLen = 60) {
  if (!str || str.length <= maxLen) return str || '';
  return str.slice(0, maxLen) + '…';
}

export function normalizeUrl(url) {
  try {
    const u = new URL(url);
    if (!u.protocol.startsWith('http')) return url;
    u.hash = '';
    const trackingParams = [
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_term',
      'utm_content', 'ref', 'fbclid', 'gclid', 'spm', 'from',
    ];
    trackingParams.forEach(p => u.searchParams.delete(p));
    u.pathname = u.pathname.replace(/\/+$/, '') || '/';
    return u.toString();
  } catch {
    return url;
  }
}

const BUILTIN_BLACKLIST = [
  '*.bank.com', '*.icbc.com.cn', '*.ccb.com', '*.boc.cn', '*.abchina.com',
  'pay.weixin.qq.com', 'cashier.alipay.com',
  '*.hospital.*', 'patient.*',
  '*.gov.cn', '*.gov',
  'mail.google.com', 'outlook.live.com', 'mail.qq.com',
  '*.1password.com', '*.lastpass.com', '*.bitwarden.com',
  'chrome://*', 'chrome-extension://*', 'about:*',
  'localhost', '127.0.0.1',
];

export { BUILTIN_BLACKLIST };

export function isDomainBlacklisted(url, blacklistConfig) {
  let hostname;
  try {
    const u = new URL(url);
    if (!u.protocol.startsWith('http')) return true;
    hostname = u.hostname;
  } catch {
    return true;
  }

  const allPatterns = [
    ...(blacklistConfig.builtinEnabled ? BUILTIN_BLACKLIST : []),
    ...blacklistConfig.custom,
  ];

  return allPatterns.some(pattern => {
    if (pattern.startsWith('*.')) {
      const base = pattern.slice(2);
      if (base.includes('*')) {
        const regex = new RegExp(
          '^' + base.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$',
        );
        return regex.test(hostname);
      }
      return hostname === base || hostname.endsWith('.' + base);
    }
    if (pattern.includes('*')) {
      const regex = new RegExp(
        '^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$',
      );
      return regex.test(hostname);
    }
    return hostname === pattern;
  });
}

export function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${y}${m}${d}-${h}${min}`;
}

export function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
