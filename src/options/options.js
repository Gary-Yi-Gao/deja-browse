import { BUILTIN_BLACKLIST } from '../lib/utils.js';

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

let currentConfig = {};
let customBlacklist = [];

// --- DOM refs ---
const recordModeRadios = document.querySelectorAll('input[name="recordMode"]');
const autoCollectEnabled = document.getElementById('auto-collect-enabled');
const providerRadios = document.querySelectorAll('input[name="provider"]');
const openaiConfig = document.getElementById('openai-config');
const zaiConfig = document.getElementById('zai-config');
const openaiApiKey = document.getElementById('openai-apikey');
const openaiBaseUrl = document.getElementById('openai-baseurl');
const openaiEmbModel = document.getElementById('openai-embedding-model');
const openaiChatModel = document.getElementById('openai-chat-model');
const zaiApiKey = document.getElementById('zai-apikey');
const zaiPlanRadios = document.querySelectorAll('input[name="zai-plan"]');
const zaiEmbModel = document.getElementById('zai-embedding-model');
const zaiChatModel = document.getElementById('zai-chat-model');
const btnTest = document.getElementById('btn-test');
const testResult = document.getElementById('test-result');
const builtinEnabled = document.getElementById('builtin-enabled');
const builtinDomains = document.getElementById('builtin-domains');
const blacklistInput = document.getElementById('blacklist-input');
const btnAddBlacklist = document.getElementById('btn-add-blacklist');
const customBlacklistEl = document.getElementById('custom-blacklist');
const maxContentLength = document.getElementById('max-content-length');
const btnExportSqlite = document.getElementById('btn-export-sqlite');
const btnExportJson = document.getElementById('btn-export-json');
const btnImport = document.getElementById('btn-import');
const importFile = document.getElementById('import-file');
const importResult = document.getElementById('import-result');
const dataStats = document.getElementById('data-stats');
const btnSave = document.getElementById('btn-save');
const saveStatus = document.getElementById('save-status');

// --- Init ---
async function loadConfig() {
  const syncData = await chrome.storage.sync.get(SYNC_DEFAULTS);
  const localData = await chrome.storage.local.get({ 'openai.apiKey': '', 'zai.apiKey': '' });
  currentConfig = { ...syncData, ...localData };
  populateUI();
}

function populateUI() {
  // Collect mode
  autoCollectEnabled.checked = currentConfig.autoCollectEnabled !== false;
  recordModeRadios.forEach(r => {
    r.checked = r.value === currentConfig.recordMode;
  });
  updateRecordModeDisabledState();

  // Provider
  providerRadios.forEach(r => {
    r.checked = r.value === currentConfig.provider;
  });
  updateProviderUI();

  // OpenAI
  openaiApiKey.value = currentConfig['openai.apiKey'] || '';
  openaiBaseUrl.value = currentConfig.openai?.baseUrl || 'https://api.openai.com/v1';
  openaiEmbModel.value = currentConfig.openai?.embeddingModel || 'text-embedding-3-small';
  openaiChatModel.value = currentConfig.openai?.chatModel || 'gpt-5.4';

  // Z.ai
  zaiApiKey.value = currentConfig['zai.apiKey'] || '';
  zaiPlanRadios.forEach(r => {
    r.checked = r.value === (currentConfig.zai?.plan || 'payg');
  });
  zaiEmbModel.value = currentConfig.zai?.embeddingModel || 'embedding-3';
  zaiChatModel.value = currentConfig.zai?.chatModel || 'glm-5';

  // Blacklist
  builtinEnabled.checked = currentConfig.blacklist?.builtinEnabled !== false;
  builtinDomains.textContent = BUILTIN_BLACKLIST.join('\n');
  customBlacklist = [...(currentConfig.blacklist?.custom || [])];
  renderCustomBlacklist();

  // Advanced
  maxContentLength.value = currentConfig.maxContentLength || 2000;
}

function updateRecordModeDisabledState() {
  const disabled = !autoCollectEnabled.checked;
  recordModeRadios.forEach(r => {
    r.disabled = disabled;
    const card = r.closest('.radio-card');
    if (card) card.classList.toggle('disabled', disabled);
  });
}

function updateProviderUI() {
  const provider = document.querySelector('input[name="provider"]:checked')?.value;
  openaiConfig.classList.toggle('active', provider === 'openai');
  zaiConfig.classList.toggle('active', provider === 'zai');
}

providerRadios.forEach(r => r.addEventListener('change', updateProviderUI));
autoCollectEnabled.addEventListener('change', updateRecordModeDisabledState);

// --- Blacklist ---
function renderCustomBlacklist() {
  customBlacklistEl.innerHTML = '';
  customBlacklist.forEach((domain, i) => {
    const li = document.createElement('li');
    li.innerHTML = `${escapeHtml(domain)} <button data-idx="${i}">×</button>`;
    customBlacklistEl.appendChild(li);
  });
}

customBlacklistEl.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-idx]');
  if (!btn) return;
  const idx = parseInt(btn.dataset.idx);
  customBlacklist.splice(idx, 1);
  renderCustomBlacklist();
});

btnAddBlacklist.addEventListener('click', () => {
  const val = blacklistInput.value.trim();
  if (val && !customBlacklist.includes(val)) {
    customBlacklist.push(val);
    renderCustomBlacklist();
    blacklistInput.value = '';
  }
});

blacklistInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') btnAddBlacklist.click();
});

// --- Test Connection ---
btnTest.addEventListener('click', async () => {
  btnTest.disabled = true;
  btnTest.textContent = '保存并测试中…';
  testResult.style.display = 'none';

  try {
    const provider = document.querySelector('input[name="provider"]:checked')?.value || 'zai';
    const zaiPlan = document.querySelector('input[name="zai-plan"]:checked')?.value || 'payg';

    await Promise.all([
      chrome.storage.local.set({
        'openai.apiKey': openaiApiKey.value,
        'zai.apiKey': zaiApiKey.value,
      }),
      chrome.storage.sync.set({
        autoCollectEnabled: autoCollectEnabled.checked,
        provider,
        openai: {
          embeddingModel: openaiEmbModel.value,
          chatModel: openaiChatModel.value,
          baseUrl: openaiBaseUrl.value || 'https://api.openai.com/v1',
        },
        zai: {
          plan: zaiPlan,
          embeddingModel: zaiEmbModel.value,
          chatModel: zaiChatModel.value,
        },
      }),
    ]);

    await new Promise(r => setTimeout(r, 200));

    const result = await chrome.runtime.sendMessage({ type: 'TEST_CONNECTION' });
    if (result?.ok) {
      testResult.className = 'test-result success';
      testResult.textContent = '连接成功！';
    } else {
      testResult.className = 'test-result error';
      testResult.textContent = `连接失败: ${result?.error || '未知错误'}`;
    }
  } catch (e) {
    testResult.className = 'test-result error';
    testResult.textContent = `错误: ${e.message}`;
  }

  testResult.style.display = 'block';
  btnTest.disabled = false;
  btnTest.textContent = '测试连接';
});

// --- Auto-save API keys on change ---
let apiKeySaveTimer = null;
function autoSaveApiKeys() {
  clearTimeout(apiKeySaveTimer);
  apiKeySaveTimer = setTimeout(() => {
    chrome.storage.local.set({
      'openai.apiKey': openaiApiKey.value,
      'zai.apiKey': zaiApiKey.value,
    });
  }, 500);
}
openaiApiKey.addEventListener('input', autoSaveApiKeys);
zaiApiKey.addEventListener('input', autoSaveApiKeys);

// --- Save ---
btnSave.addEventListener('click', async () => {
  const provider = document.querySelector('input[name="provider"]:checked')?.value || 'zai';
  const recordMode = document.querySelector('input[name="recordMode"]:checked')?.value || 'auto';
  const zaiPlan = document.querySelector('input[name="zai-plan"]:checked')?.value || 'payg';

  const syncData = {
    autoCollectEnabled: autoCollectEnabled.checked,
    recordMode,
    provider,
    openai: {
      embeddingModel: openaiEmbModel.value,
      chatModel: openaiChatModel.value,
      baseUrl: openaiBaseUrl.value || 'https://api.openai.com/v1',
    },
    zai: {
      plan: zaiPlan,
      embeddingModel: zaiEmbModel.value,
      chatModel: zaiChatModel.value,
    },
    blacklist: {
      custom: customBlacklist,
      builtinEnabled: builtinEnabled.checked,
    },
    maxContentLength: parseInt(maxContentLength.value) || 2000,
  };

  const localData = {
    'openai.apiKey': openaiApiKey.value,
    'zai.apiKey': zaiApiKey.value,
  };

  const errors = [];
  try { await chrome.storage.local.set(localData); } catch (e) { errors.push('API Key: ' + e.message); }
  try { await chrome.storage.sync.set(syncData); } catch (e) { errors.push('设置: ' + e.message); }

  if (errors.length) {
    saveStatus.textContent = '部分保存失败: ' + errors.join('; ');
    saveStatus.style.color = '#ef4444';
  } else {
    saveStatus.textContent = '已保存';
    saveStatus.style.color = '';
  }
  setTimeout(() => { saveStatus.textContent = ''; saveStatus.style.color = ''; }, 3000);
});

// --- Import / Export ---

function setButtonLoading(btn, loading, text) {
  btn.disabled = loading;
  btn.textContent = loading ? '⏳ ' + text : btn.dataset.label;
}

btnExportSqlite.dataset.label = btnExportSqlite.textContent;
btnExportJson.dataset.label = btnExportJson.textContent;
btnImport.dataset.label = btnImport.textContent;

btnExportSqlite.addEventListener('click', async () => {
  setButtonLoading(btnExportSqlite, true, '正在导出 SQLite…');
  try {
    const bytes = await chrome.runtime.sendMessage({ type: 'EXPORT_DB' });
    if (bytes) {
      const blob = new Blob([new Uint8Array(bytes)], { type: 'application/x-sqlite3' });
      downloadBlob(blob, `deja-browse-backup-${formatDate()}.sqlite3`);
    }
  } catch (e) {
    alert('导出失败: ' + e.message);
  }
  setButtonLoading(btnExportSqlite, false);
});

btnExportJson.addEventListener('click', async () => {
  setButtonLoading(btnExportJson, true, '正在导出 JSON…');
  try {
    const pages = await chrome.runtime.sendMessage({ type: 'GET_ALL_PAGES' });
    const blob = new Blob([JSON.stringify(pages || [], null, 2)], { type: 'application/json' });
    downloadBlob(blob, `deja-browse-backup-${formatDate()}.json`);
  } catch (e) {
    alert('导出失败: ' + e.message);
  }
  setButtonLoading(btnExportJson, false);
});

btnImport.addEventListener('click', () => importFile.click());

importFile.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const wantMerge = confirm(
    '请选择导入策略：\n\n'
    + '【确定】= 合并模式（保留现有数据，仅添加新页面）\n'
    + '【取消】= 取消导入',
  );

  if (!wantMerge) {
    const wantOverwrite = confirm(
      '⚠️ 是否使用覆盖模式？\n\n'
      + '覆盖模式会删除当前所有已收录的数据，替换为导入文件中的内容。\n\n'
      + '此操作不可撤销，确定要继续吗？',
    );
    if (!wantOverwrite) {
      importFile.value = '';
      return;
    }
  }

  const strategy = wantMerge ? 'merge' : 'overwrite';

  setButtonLoading(btnImport, true, '正在导入…');
  importResult.style.display = 'none';

  try {
    const buffer = await file.arrayBuffer();
    const header = Array.from(new Uint8Array(buffer.slice(0, 16)))
      .map(b => String.fromCharCode(b)).join('');
    const format = header.startsWith('SQLite format 3') ? 'sqlite' : 'json';

    const result = await chrome.runtime.sendMessage({
      type: 'IMPORT_DB',
      bytes: Array.from(new Uint8Array(buffer)),
      format,
      strategy,
    });

    importResult.className = 'test-result success';
    importResult.textContent = `导入成功！共 ${result?.count || 0} 条收录（${strategy === 'merge' ? '合并' : '覆盖'}模式）`;
    importResult.style.display = 'block';
    loadStats();
  } catch (err) {
    importResult.className = 'test-result error';
    importResult.textContent = `导入失败: ${err.message}`;
    importResult.style.display = 'block';
  }

  setButtonLoading(btnImport, false);
  importFile.value = '';
});

// --- Stats ---
async function loadStats() {
  dataStats.textContent = '加载中…';
  for (let i = 0; i < 3; i++) {
    try {
      const stats = await chrome.runtime.sendMessage({ type: 'GET_STATS' });
      if (stats) {
        let text = `已收录 ${stats.totalPages} 个页面，其中 ${stats.withVector} 个已向量化`;
        if (stats.persistent === false) {
          text += '\n⚠ 存储异常：数据库运行在临时模式，数据可能不完整。请刷新页面重试。';
        }
        dataStats.textContent = text;
        return;
      }
    } catch { /* retry */ }
    if (i < 2) await new Promise(r => setTimeout(r, 2000));
  }
  dataStats.textContent = '暂时无法获取统计，请稍后刷新页面';
}

// --- Helpers ---
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function formatDate() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}${String(d.getMilliseconds()).padStart(3, '0')}`;
}

// --- Start ---
loadConfig();
loadStats();
