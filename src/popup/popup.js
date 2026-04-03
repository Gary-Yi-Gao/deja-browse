const viewSearch = document.getElementById('view-search');
const viewSettings = document.getElementById('view-settings');
const searchInput = document.getElementById('search-input');
const resultsContainer = document.getElementById('results');
const emptyState = document.getElementById('empty-state');
const statsEl = document.getElementById('stats');
const btnSettings = document.getElementById('btn-settings');
const btnBack = document.getElementById('btn-back');
const btnOpenOptions = document.getElementById('btn-open-options');
const btnCollect = document.getElementById('btn-collect');
const connectionStatus = document.getElementById('connection-status');
const settingsStats = document.getElementById('settings-stats');
const activityBar = document.getElementById('activity-bar');
const activityText = document.getElementById('activity-text');
const activityCount = document.getElementById('activity-count');
const modeHint = document.getElementById('mode-hint');

let searchTimer = null;
let statusPollTimer = null;
let collectStatusTimer = null;

function sendMsg(msg, timeoutMs = 8000) {
  return Promise.race([
    chrome.runtime.sendMessage(msg),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
  ]);
}

function sendTabMsg(tabId, msg, timeoutMs = 5000) {
  return Promise.race([
    chrome.tabs.sendMessage(tabId, msg),
    new Promise((_, reject) => setTimeout(() => reject(new Error('tab message timeout')), timeoutMs)),
  ]);
}

// --- Activity status polling ---

async function pollCollectStatus() {
  try {
    const status = await sendMsg({ type: 'GET_COLLECT_STATUS' }, 3000);
    if (!status) return;

    const isActive = status.running || status.queueLength > 0;

    if (isActive) {
      activityBar.classList.remove('hidden');
      const currentTitle = status.current?.title || status.current?.url || '';
      const truncated = currentTitle.length > 30 ? currentTitle.slice(0, 30) + '…' : currentTitle;
      activityText.textContent = `正在采集: ${truncated}`;
      const pending = status.queueLength;
      activityCount.textContent = pending > 0 ? `队列 ${pending}` : '';
    } else {
      if (!activityBar.classList.contains('hidden') && status.completed > 0) {
        activityText.textContent = `采集完成`;
        activityCount.textContent = `${status.completed} 个页面`;
        activityBar.querySelector('.activity-spinner').style.display = 'none';
        setTimeout(() => {
          activityBar.classList.add('hidden');
          const spinner = activityBar.querySelector('.activity-spinner');
          if (spinner) spinner.style.display = '';
        }, 2500);
      } else {
        activityBar.classList.add('hidden');
      }
    }

    if (status.lastError && !isActive) {
      statsEl.textContent = `最近一次采集异常: ${status.lastError}`;
    }
  } catch { /* popup closing or SW unavailable */ }
}

function startStatusPolling() {
  pollCollectStatus();
  statusPollTimer = setInterval(pollCollectStatus, 1500);
}

function stopStatusPolling() {
  clearInterval(statusPollTimer);
}

// --- Collect current page ---

btnCollect.addEventListener('click', async () => {
  if (btnCollect.classList.contains('collecting')) return;

  btnCollect.classList.add('collecting');
  btnCollect.textContent = '采集中…';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      const resp = await sendTabMsg(tab.id, { type: 'MANUAL_COLLECT' }, 5000);
      const ok = resp === true || resp?.ok === true;
      if (!ok) {
        const reason = resp?.reason || (resp === false ? 'manual collect rejected' : 'manual collect rejected');
        throw new Error(reason);
      }
      btnCollect.classList.remove('collecting');
      btnCollect.classList.add('done');
      btnCollect.textContent = '✓ 已发送';
      setTimeout(() => {
        btnCollect.classList.remove('done');
        btnCollect.textContent = '+ 收录';
      }, 2000);
      setTimeout(pollCollectStatus, 500);
      scheduleCollectVerification();
    }
  } catch (e) {
    btnCollect.classList.remove('collecting');
    const msg = String(e?.message || '');
    if (msg.includes('Receiving end does not exist')) {
      btnCollect.textContent = '当前页面不可收录';
      statsEl.textContent = '当前页面未注入采集脚本（请刷新页面后重试）';
    } else {
      btnCollect.textContent = '收录失败';
      statsEl.textContent = `收录失败原因: ${msg}`;
    }
    setTimeout(() => { btnCollect.textContent = '+ 收录'; }, 2000);
  }
});

function scheduleCollectVerification() {
  clearTimeout(collectStatusTimer);
  collectStatusTimer = setTimeout(checkCurrentPageCollected, 2500);
}

async function checkCurrentPageCollected() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url?.startsWith('http')) return;
    const status = await sendMsg({ type: 'GET_PAGE_STATUS', url: tab.url }, 10000);
    if (status?.exists) {
      statsEl.textContent = '当前页面已收录';
      setTimeout(() => loadStats(), 1200);
    } else {
      statsEl.textContent = '当前页面尚未收录';
      setTimeout(() => loadStats(), 1200);
    }
  } catch { /* ignore */ }
}

// --- View switching ---

btnSettings.addEventListener('click', () => {
  viewSearch.classList.add('view-hidden');
  viewSettings.classList.remove('view-hidden');
  loadSettingsView();
});

btnBack.addEventListener('click', () => {
  viewSettings.classList.add('view-hidden');
  viewSearch.classList.remove('view-hidden');
  searchInput.focus();
});

btnOpenOptions.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// --- Quick settings ---

async function loadSettingsView() {
  const syncData = await chrome.storage.sync.get({
    autoCollectEnabled: true,
    recordMode: 'auto',
    provider: 'zai',
  });

  document.querySelectorAll('.toggle-btn[data-auto-collect]').forEach(btn => {
    const enabled = syncData.autoCollectEnabled !== false;
    const isOn = btn.dataset.autoCollect === 'on';
    btn.classList.toggle('active', (enabled && isOn) || (!enabled && !isOn));
  });

  document.querySelectorAll('.toggle-btn[data-mode]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === syncData.recordMode);
  });
  setModeControlsEnabled(syncData.autoCollectEnabled !== false);

  document.querySelectorAll('.toggle-btn[data-provider]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.provider === syncData.provider);
  });

  checkConnection();
  loadSettingsStats();
}

function setModeControlsEnabled(enabled) {
  document.querySelectorAll('.toggle-btn[data-mode]').forEach(btn => {
    btn.disabled = !enabled;
    btn.classList.toggle('disabled', !enabled);
  });
  modeHint.textContent = enabled ? '' : '自动收录已关闭，当前仅支持手动收录';
}

document.querySelectorAll('.toggle-btn[data-auto-collect]').forEach(btn => {
  btn.addEventListener('click', async () => {
    const enabled = btn.dataset.autoCollect === 'on';
    document.querySelectorAll('.toggle-btn[data-auto-collect]').forEach(b => {
      b.classList.toggle('active', b === btn);
    });
    setModeControlsEnabled(enabled);
    await chrome.storage.sync.set({ autoCollectEnabled: enabled });
  });
});

document.querySelectorAll('.toggle-btn[data-mode]').forEach(btn => {
  btn.addEventListener('click', async () => {
    if (btn.disabled) return;
    document.querySelectorAll('.toggle-btn[data-mode]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    await chrome.storage.sync.set({ recordMode: btn.dataset.mode });
  });
});

document.querySelectorAll('.toggle-btn[data-provider]').forEach(btn => {
  btn.addEventListener('click', async () => {
    document.querySelectorAll('.toggle-btn[data-provider]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    await chrome.storage.sync.set({ provider: btn.dataset.provider });
    checkConnection();
  });
});

async function checkConnection() {
  const dot = connectionStatus.querySelector('.status-dot');
  const text = connectionStatus.querySelector('.status-text');
  dot.className = 'status-dot';
  text.textContent = '检查中…';

  try {
    const result = await sendMsg({ type: 'TEST_CONNECTION' });
    if (result?.ok) {
      dot.classList.add('ok');
      text.textContent = '已连接';
    } else {
      dot.classList.add('err');
      text.textContent = result?.error || '连接失败';
    }
  } catch {
    dot.classList.add('err');
    text.textContent = '未配置 API Key';
  }
}

async function loadSettingsStats() {
  settingsStats.textContent = '加载中…';
  for (let i = 0; i < 3; i++) {
    try {
      const stats = await sendMsg({ type: 'GET_STATS' }, 15000);
      if (stats) {
        settingsStats.textContent = `已收录 ${stats.totalPages} 个页面，其中 ${stats.withVector} 个已向量化`;
        return;
      }
    } catch { /* retry */ }
    if (i < 2) await new Promise(r => setTimeout(r, 2000));
  }
  settingsStats.textContent = '暂时无法获取统计，请稍后重试';
}

// --- Search ---

searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const query = searchInput.value.trim();

  if (!query) {
    showEmpty();
    return;
  }

  showLoading();
  searchTimer = setTimeout(() => doSearch(query), 150);
});

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    clearTimeout(searchTimer);
    const query = searchInput.value.trim();
    if (query) doSearch(query);
  }
});

async function doSearch(query) {
  try {
    const results = await sendMsg({ type: 'FULL_SEARCH', query });
    if (results && results.length > 0) {
      renderResults(results);
    } else {
      showNoResults();
    }
  } catch (e) {
    console.error('Search error:', e);
    showNoResults();
  }
}

function renderResults(results) {
  emptyState.style.display = 'none';
  resultsContainer.innerHTML = '';
  resultsContainer.style.display = 'block';

  for (const r of results) {
    const item = document.createElement('a');
    item.className = 'result-item';
    item.href = r.url;
    item.target = '_blank';
    item.rel = 'noopener';

    const badge = r.source === 'semantic'
      ? '<span class="result-badge semantic">语义</span>'
      : '<span class="result-badge">文本</span>';

    item.innerHTML = `
      <div class="result-title">${escapeHtml(r.title)}</div>
      <div class="result-snippet">${escapeHtml(r.summary || r.contentSnippet || '')}</div>
      <div class="result-meta">
        <span class="result-url">${escapeHtml(r.url)}</span>
        ${badge}
      </div>
    `;

    resultsContainer.appendChild(item);
  }
}

function showEmpty() {
  resultsContainer.style.display = 'none';
  resultsContainer.innerHTML = '';
  emptyState.style.display = 'flex';
}

function showNoResults() {
  emptyState.style.display = 'none';
  resultsContainer.style.display = 'block';
  resultsContainer.innerHTML = '<div class="empty-state"><p>未找到匹配结果</p></div>';
}

function showLoading() {
  emptyState.style.display = 'none';
  resultsContainer.style.display = 'block';
  resultsContainer.innerHTML = '<div class="loading">搜索中</div>';
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function loadStats() {
  for (let i = 0; i < 3; i++) {
    try {
      const stats = await sendMsg({ type: 'GET_STATS' }, 15000);
      if (stats) {
        statsEl.textContent = `已收录 ${stats.totalPages} 个页面`;
        return;
      }
    } catch { /* retry */ }
    if (i < 2) await new Promise(r => setTimeout(r, 2000));
  }
}

// --- Init ---

loadStats();
startStatusPolling();

window.addEventListener('unload', stopStatusPolling);
