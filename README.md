# Deja Browse (拾迹) — 使用与开发指南

## 项目简介

Deja Browse（拾迹）是一个基于 Chrome Manifest V3 的本地优先浏览记忆插件。  
它会把你浏览过的网页内容做结构化收录，并结合全文检索与语义检索，帮助你用自然语言快速找回“之前看过但忘了在哪”的页面。

核心特点：

- **自动/手动收录**：支持浏览即收录、收藏时收录，也可一键关闭自动收录
- **双层检索**：SQLite FTS5 文本检索 + Embedding 语义检索并行，结果合并去重
- **多供应商支持**：兼容 OpenAI（Codex）与 Z.ai（含 Coding Plan）
- **本地数据优先**：基于 OPFS + SQLite Wasm 存储，支持 JSON / SQLite 导入导出
- **低打扰体验**：地址栏 `dj + Tab` 搜索、Popup 快捷设置、收录状态提示

## 面向使用者：快速上手

仓库已包含构建好的 `dist/`，你可以直接加载使用，无需先执行 `npm install` 或 `npm run build`。

### 1. 在 Chrome 中加载扩展（优先）

1. 打开 Chrome，地址栏输入 `chrome://extensions`
2. 右上角开启 **开发者模式**
3. 点击 **加载已解压的扩展程序**
4. 选择项目根目录下的 `dist/` 文件夹
5. 扩展加载成功后，工具栏会出现「拾迹」图标

### 2. 首次使用配置

扩展安装后会自动打开 Options 设置页，你需要：

1. 选择 **LLM 供应商**（OpenAI 或 Z.ai）
2. 填写对应的 **API Key**
3. 如使用 Z.ai Coding Plan，切换套餐类型为「Coding Plan」
4. 点击 **测试连接** 确认 API Key 有效
5. 点击 **保存设置**

配置完成后即可开始浏览网页，扩展会根据收录设置自动或手动采集页面内容。

### 3. 配置入口

插件提供两个配置入口：

- **Popup 快捷设置**：点击工具栏的拾迹图标，再点击右上角 ⚙ 齿轮按钮，即可在弹窗内开启/关闭自动收录、切换收录模式、切换 LLM 供应商、查看连接状态和数据统计、手动收录当前页面（关闭自动收录后，“收录模式”会置灰）
- **Options 完整设置页**：在 Popup 快捷设置中点击「打开完整设置页」按钮，或在 `chrome://extensions` 中点击扩展的「选项」链接，可配置 API Key、模型选择、黑名单域名、数据导入导出等完整功能

### 4. 使用搜索

- **地址栏搜索**：输入 `dj` 然后按 Tab 键，再输入关键词即可搜索浏览记忆
- **弹窗搜索**：点击工具栏的拾迹图标，在搜索框中输入关键词

### 5. 手动收录验证（建议）

1. 打开任意普通 `https` 页面（不要用 `chrome://`、扩展页、内置页）
2. 点击插件图标，再点击 `+ 收录`
3. 等待 2~4 秒，观察弹窗底部：
   - 出现 `当前页面已收录` 代表写库成功
   - 若失败会显示 `收录失败原因: ...`，可直接按提示排查

## 面向开发者：本地开发与构建（可选）

### 环境要求

- **Node.js** >= 18
- **npm** >= 9
- **Vite** 使用 `^5.x`（已在 `package.json` 锁定，避免与 CRXJS 2.4 在内容脚本注入链路上不兼容）
- **Chrome** >= 116（需支持 Manifest V3 + OPFS）

### 开发模式

```bash
cd deja-browse
npm install
npm run dev
```

Vite + CRXJS 会启动开发服务器并在 `dist/` 目录生成带 HMR 支持的扩展文件。  
代码改动后大部分会自动热更新；若涉及 Service Worker 或 manifest，需在 `chrome://extensions` 手动点击刷新。

### 生产构建

```bash
npm run build
```

构建产物在 `dist/` 目录，可直接用于 Chrome 加载或打包为 `.crx` 发布。

## 项目结构概览

```
src/
├── background/service-worker.js   # 核心调度（采集、搜索、Omnibox、右键菜单）
├── content/content-script.js      # 网页内容提取（Readability.js）
├── offscreen/                     # Offscreen Document（SQLite 中转层）
├── db/                            # SQLite Wasm 存储层（Worker + OPFS）
├── popup/                         # 弹窗搜索界面
├── options/                       # 设置页面
└── lib/                           # 共享模块
    ├── config.js                  #   配置管理
    ├── llm-provider.js            #   LLM 多供应商适配
    ├── search.js                  #   双层搜索引擎
    ├── extractor.js               #   正文提取
    ├── import-export.js           #   数据导入导出
    └── utils.js                   #   工具函数
```

## 常见问题

### 扩展加载后没有反应

确认 `dist/` 目录存在且包含 `manifest.json`，并且加载的是当前仓库下最新 `dist/`。

如果你曾反复热更新并出现行为异常，建议做一次“干净重载”：

1. 停止 `npm run dev`
2. 在 `chrome://extensions` 移除当前拾迹扩展
3. 重新执行 `npm run dev`
4. 重新“加载已解压扩展程序”并选择最新 `dist/`

### Omnibox 搜索无结果

需要先配置 API Key 并采集一些页面。纯文本搜索（FTS5）不依赖 API Key，但语义搜索需要 Embedding API 可用。

### SQLite / OPFS 相关报错

确保 Chrome 版本 >= 116。部分企业策略可能限制 OPFS 访问，尝试使用个人 Chrome 配置。

### `vendor/vite-client.js` 或内容脚本注入报错

- 这是开发期注入链路问题，通常由“旧扩展实例 + 新构建产物混用”导致
- 先按“干净重载”步骤操作（上文）
- 若页面为旧标签页，务必刷新后再测手动收录

### `WebAssembly.instantiate(): BufferSource argument is empty`

- 通常是 Offscreen/Worker 在热更新后进入坏状态
- 重新加载扩展后会自动重建链路；若仍出现，执行一次“干净重载”

### 点击收录后一直“采集中…”

- 当前版本已对手动收录改为“快速确认 + 后台异步执行”
- 若仍卡住，优先检查该页是否允许注入内容脚本（普通 `http/https` 页面）
