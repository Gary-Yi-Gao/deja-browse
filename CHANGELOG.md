# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.0.7] - 2026-04-10

### Fixed

- **修复收录数据归零问题**：OPFS SAH Pool VFS 初始化失败时不再静默回退到内存数据库，改为重试 3 次后抛出明确错误，由上层通信链路自动重建恢复。这是导致用户看到"已收录 0 个页面"的核心原因。
- **导入覆盖误操作防护**：原 `confirm()` 对话框中"取消"按钮被映射为"覆盖"（清空数据），现已改为"取消"即取消导入；选择覆盖模式时增加二次确认，并在导入前校验文件有效性，防止空文件覆盖导致数据丢失。

### Added

- **OPFS Pool VFS 重试机制**：`installOpfsSAHPoolVfs` 增加 3 次重试（递增延迟 400ms/800ms/1200ms），并设置 `clearOnInit: false` 防止 Pool 被意外清空。
- **Web Locks 并发保护**：`initDb()` 使用 `navigator.locks.request()` 防止多个 Worker 实例同时争抢 OPFS Pool 文件锁。
- **持久化状态可观测**：`getStats()` 返回新增 `persistent` 字段；Popup 和 Options 页面在数据库处于非持久化状态时显示警告。
- **全链路日志**：WASM 初始化、Pool VFS 初始化、导入/导出操作均输出带 `[DB Worker]` 前缀的日志，便于排查问题。

### Changed

- Offscreen Document 重置后增加 500ms 等待，给旧 Worker 释放 OPFS 文件锁的时间，最小重置间隔从 1s 提升到 2s。
- `sendToOffscreen` 的可恢复错误列表新增 `OPFS Pool VFS init failed`，确保 Pool VFS 初始化失败时触发自动重建。
