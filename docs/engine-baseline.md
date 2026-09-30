# Codex 开源引擎冻结基线（2026-09-29）

本轮仅交付 **Windows x64**，目标为 GitHub 开源引擎。冻结 tag 为
[`rust-v0.159.2`](https://github.com/openai/codex/releases/tag/rust-v0.159.2)，
解引用源码 SHA 为 `ff6aec96948b70d94983af2641a6b67c94faeff5`。
机器可读记录在 [config/engine-baseline.json](../config/engine-baseline.json)，安装脚本和新版 CI 从同一记录读取 SHA。

| 公开发布组件 | 冻结版本 |
| --- | --- |
| CLI `@openai/codex` | `0.159.2` |
| TypeScript SDK `@openai/codex-sdk` | `0.159.2` |
| Python SDK `openai-codex` | `0.159.2` |
| Python runtime `openai-codex-cli-bin` | `0.159.2` |

上述注册表版本已在 #6 的 0.159 resolution 中核实。tag 中 CLI/workspace 的 `0.0.0`、SDK 的
`0.0.0-dev` 等源码占位版本不代表发布版本；最终组合引擎应报告 `0.159.2`，由 #29/#30 迁移和
#31/#16 构建验收验证。包版本一致也不能证明默认 runtime 含本仓库补丁。
SDK 测试依赖目前仍保留历史 `0.158.0` pin；升级和公开 API 验收由 #32/#33 承接。
tag 的 Python 源码依赖仍写 `openai-codex-cli-bin==0.153.4`，不能据此覆盖已核实的
公开 wheel/runtime `0.159.2` 版本记录。

## 仅验证冻结源码

本机串行复用 `E:\Projects\codex`，分支 `codex/multiprovider-0.159.2`。保留原
`multiprovider-routing` 分支及忽略的 `work/asar-tools`，不另 clone 或创建 engine worktree。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/install-engine.ps1 -BaselineOnly -VerifyOnly -EnginePath E:\Projects\codex
$env:CODEX_TEST_UPSTREAM_CHECKOUT = 'E:\Projects\codex'
node --test tools/engine-baseline.test.mjs
```

此入口只需要 Git：先检查完整 HEAD 与干净状态，再退出；不应用补丁，不调用 Rust/Cargo，不构建
stock CLI。错误 SHA、Git 读取失败或脏源码均拒绝，不自动切换分支、重置或丢弃用户文件。
稳定基线模式要求显式 `-EnginePath`，不接受 `-WorkDir` 或另建引擎。省略 `-VerifyOnly`
仍是显式 stock 构建入口，但本轮不执行，最终启动和 initialize 使用后续唯一组合产物验收。

## 新版组合安装与尚未完成的验证

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/install-engine.ps1 -CombinedPatch -EnginePath E:\Projects\codex -Profile debug
```

这是为新版四补丁组合保留的明确入口，继续拒绝执行，不会套用 0.158/0.154 diff。
#29 已迁移路由、会话、分叉、子代理绑定，新增 `-BindingPatchesOnly` 无构建入口及
新版三补丁轻量 CI，见[迁移映射与源码交接](binding-migration-0.159.md)。
#30 迁移父代理完成通知与唤醒后接通四补丁组合。它们的关闭仅表示补丁生成、按序适用性和差异审查完成。

#31 将四份补丁按序应用到冻结 SHA，复用 E 盘唯一 Cargo target，增量构建一次 debug CLI，
执行 focused Rust 与 GLM 离线工具闭环；#32/#33 复用该 binary 测双 SDK；#16 集中验收完整
Windows 矩阵。不要逐票 cargo clean、release 构建或跑整个上游 Rust workspace。
源码/补丁指纹变化时重新增量构建并重验受影响行为。

CLI 版本与 stdio app-server initialize 的独立轻量运行入口保留在
`tools/engine-initialize.test.mjs`，设置 `CODEX_TEST_ROUTED_BINARY` 为后续组合产物后运行。
#28 没有构建、启动 CLI 或验证 initialize，没有 0.159 路由/绑定/唤醒/GLM/SDK 行为通过结论。
真实在线验收仍需逐服务身份授权，本票只使用源码与离线测试。

## CI 与历史边界

- PR 自动工作流 `patch-applies.yml` 只运行 Windows 轻量版本、安装脚本、语法和适用性检查，
  只触发 `pull_request`（另可手动触发），无 push/PR 重复运行，无 Linux runner。
- 新版基线 job 验证 0.159.2 元数据、干净源码及三份绑定补丁的顺序预检/应用，不构建 Rust。
- `historical-154-patch-applies` 与 `historical-158-binding-patches-apply` 明确检查旧 SHA。
  对旧固定 SHA 的适用性通过仅是历史回归，不能替代新版检查。
- `model-routing.yml` 保留 Windows 重型构建和关键行为测试，仅 `workflow_dispatch`；
  当前仍是明确标识的 0.158 历史验收，具有增量缓存及并发取消。#30 再 retarget 到新版完整组合。
  本轮最终重型行为证据来自 #31/#16 的本机 Windows 验收，PR 自动 CI 不重复编译 Rust。

0.158 的已完成票、补丁及报告保留，完整原始范围见
[0.158 历史基线与验收](engine-baseline-0.158.md)，仅对应
`064c6b8c737f5b41d171fdda80bd9ef10ad06eb3`。
`-RoutingPatch` 仍明确是历史 0.158 单路由补丁模式；不传稳定模式仍是历史 0.154 默认安装，
固定 `1715e55076737158ba61d43158ede504de6d4ce1`。它们都拒绝 0.159 checkout。
本票不改变 Microsoft Store 桌面端或用户已有上游分支。
