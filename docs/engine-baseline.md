# Codex 开源引擎基线（2026-09-28）

本项目移植补丁的目标是 GitHub 开源版，而非 Microsoft Store 安装的桌面端引擎。实施开始时复核的最新稳定 release 为 [`rust-v0.158.0`](https://github.com/openai/codex/releases/tag/rust-v0.158.0)，解引用到提交 `064c6b8c737f5b41d171fdda80bd9ef10ad06eb3`；CLI/workspace 版本为 `0.158.0`。安装脚本的 `-BaselineOnly` 构建未打补丁的原版引擎；`-RoutingPatch` 在相同干净基线上应用 #8 模型路由与 #9 会话供应商绑定补丁。默认安装入口仍绑定旧补丁的旧 SHA，旧功能并未在新基线上整体迁移。

| 对应组件 | 在此基线复核到的版本或约束 |
| --- | --- |
| npm CLI `@openai/codex` | 已发布 `0.158.0` |
| npm TypeScript SDK `@openai/codex-sdk` | 已发布 `0.158.0`；tag 中 `sdk/typescript/package.json` 为源码占位 `0.0.0-dev` |
| Python SDK `openai-codex` | tag 中 `sdk/python/pyproject.toml` 为源码占位 `0.0.0-dev` |
| Python runtime `openai-codex-cli-bin` | tag 中 SDK 依赖固定为 `0.153.4`；#15 复核公开发布的 SDK `0.158.0` wheel 实际依赖 runtime `0.158.0`，版本已配对，但默认 runtime 不含本仓库补丁 |

以上是 release/tag、包注册表和仓库源码的不同版本视角，不能把源码占位版本当作发布版本，也不能把 Python 的旧 runtime pin 当作已验证兼容的新引擎。基线票 #7 只验证 CLI 和 app-server initialize；#8/#9 的独立补丁验证路由与会话绑定，不声称 GLM 请求或 SDK 行为已经适配。

在干净的 `rust-v0.158.0` checkout 上执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/install-engine.ps1 -BaselineOnly -EnginePath C:\path\to\codex -Profile debug
$env:CODEX_TEST_UPSTREAM_CHECKOUT = 'C:\path\to\codex'
node --test tools/engine-baseline.test.mjs
```

测试从安装入口构建 CLI，核对 `codex --version`，经原版 `codex app-server` 的 stdio JSON-RPC 完成 initialize，并确认上游 checkout 未留下改动。Windows 构建需要 MSVC Rust toolchain；首次 Cargo 构建较慢。之后移植新路由补丁时，再更新默认安装路径和交付矩阵。

## 父代理完成通知增量补丁（#12）

[`patch/parent-completion.patch`](../patch/parent-completion.patch) 独立针对上述 `rust-v0.158.0` SHA，不包含旧版供应商路由补丁。它给 `[agents]` 增加 `wake_parent_on_completion`（默认 `true`）：子代理成功、错误或中断后向直接父代理投递一次结果；开启时唤醒有执行容量的空闲父代理，关闭、容量不足或父代理正在运行时只排队。它不修改 Microsoft Store 客户端，也不使 `-BaselineOnly` 变成多供应商构建。

在**干净的**固定版本开源引擎 checkout 中单独应用和验证：

```powershell
git -C C:\path\to\codex apply --check C:\path\to\codex-multiprovider\patch\parent-completion.patch
git -C C:\path\to\codex apply C:\path\to\codex-multiprovider\patch\parent-completion.patch
cd C:\path\to\codex\codex-rs
just test -p codex-app-server parent_completion_wake
just test -p codex-core load_config_resolves_agent_controls
```

此补丁暂不由默认 `install-engine.ps1` 自动应用；后续路由补丁迁移票再处理组合构建与安装入口。

## 分叉线程供应商绑定增量补丁（#10）

[`patch/fork-provider-binding-0.158.patch`](../patch/fork-provider-binding-0.158.patch) 以 #8/#9 的
`model-provider-routes-0.158.patch` 为前置，针对同一 `rust-v0.158.0` SHA。它在 fork 时继承来源线程
的供应商和最后模型，拒绝显式跨供应商选择；`codex exec fork` 只传递 CLI 中显式选择的模型/供应商，
不会把变化后的配置默认值误当成覆盖。持久分叉可按原供应商恢复。

在干净 checkout 中依次 `git apply --check`、`git apply` 两个补丁后构建 `codex-cli`，并用构建出的
`codex.exe` 设置 `CODEX_TEST_ROUTED_BINARY` 运行 `node --test tools/model-routing.test.mjs`。
目前安装脚本的 `-RoutingPatch` 只应用第一份补丁；增量补丁需要手动应用并重新构建，不修改
Microsoft Store 引擎。

## 子代理供应商绑定增量补丁（#11）

[`patch/subagent-provider-binding-0.158.patch`](../patch/subagent-provider-binding-0.158.patch)
依次以前述 0.158 路由和分叉补丁为前置。它在 `spawn_agent` 解析显式模型、角色默认和系统默认模型后、
创建子线程前检查目标供应商是否等于父线程供应商；拒绝时报告模型、目标及父供应商。已有
`-RoutingPatch` 安装入口仍只应用第一份补丁，因此需手动依序应用三份补丁并重新构建。
`model-routing.yml` 在 Windows 和 Linux 上检查组合补丁、Rust 子代理 seam 和模拟供应商 CLI 行为。

## Z.AI Coding Plan Responses 离线验收（#13）

在固定 `064c6b8c737f5b41d171fdda80bd9ef10ad06eb3` 基线上，按顺序应用上面的
`model-provider-routes-0.158.patch`、`fork-provider-binding-0.158.patch`、
`subagent-provider-binding-0.158.patch` 和 `parent-completion.patch`。这张票的
Responses 直连无需额外引擎或代理补丁：`config/zai-coding-plan.config-snippet.toml`
将 `glm-5.3-flash` 约束到独立的 Coding Plan 服务身份，
`config/zai-models.json` 仅在目录中暴露 `low/high/max`，默认 `max`。

用构建的 patched `codex` 设置 `CODEX_TEST_ROUTED_BINARY`，运行
`node --test tools/glm-responses.test.mjs`。测试用隔离的 `CODEX_HOME`、假凭据和
127.0.0.1 HTTP mock，不接触真实 Z.AI 或用户引擎。覆盖最终 `/api/v1/responses`
路径、文本与 SSE 完成、工具 `call_id` 及结果续轮、第二轮、缺尾、字段拒绝、
401/403/429/503、取消和诊断脱敏。CI 在 Linux/Windows x64 构建并运行此测试。
这只证明离线协议行为；Coding Plan 在线兼容及普通按量服务身份资格均未验证。

## Python SDK 离线验收（#15）

公开 PyPI `openai-codex==0.158.0` 通过 `CodexConfig(codex_bin=...)` 指向上述
固定 SHA 的四补丁组合引擎。初始化、线程、轮次、实时 delta 通知、跨进程恢复、
fork 继承供应商和错误路径均走真实 app-server；HTTP 供应商使用无真实密钥的本地 mock。
未修改 SDK 源码。发布 wheel 的 runtime pin 已为 `0.158.0`，不能用 tag 中旧 pin
推断发布包不兼容，也不能用版本相同推断默认 runtime 已含补丁。
运行命令、独立类型检查及验收边界见 [Python SDK 测试说明](../tools/sdk/python/README.md)。
