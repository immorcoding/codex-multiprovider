# Codex 开源引擎基线（2026-09-28）

本项目移植补丁的目标是 GitHub 开源版，而非 Microsoft Store 安装的桌面端引擎。实施开始时复核的最新稳定 release 为 [`rust-v0.158.0`](https://github.com/openai/codex/releases/tag/rust-v0.158.0)，解引用到提交 `064c6b8c737f5b41d171fdda80bd9ef10ad06eb3`；CLI/workspace 版本为 `0.158.0`。安装脚本的 `-BaselineOnly` 构建未打补丁的原版引擎；`-RoutingPatch` 在相同干净基线上应用 #8 模型路由与 #9 会话供应商绑定补丁。默认安装入口仍绑定旧补丁的旧 SHA，旧功能并未在新基线上整体迁移。

| 对应组件 | 在此基线复核到的版本或约束 |
| --- | --- |
| npm CLI `@openai/codex` | 已发布 `0.158.0` |
| npm TypeScript SDK `@openai/codex-sdk` | 已发布 `0.158.0`；tag 中 `sdk/typescript/package.json` 为源码占位 `0.0.0-dev` |
| Python SDK `openai-codex` | tag 中 `sdk/python/pyproject.toml` 为源码占位 `0.0.0-dev` |
| Python runtime `openai-codex-cli-bin` | tag 中 SDK 依赖固定为 `0.153.4`，runtime 源码版本同为 `0.0.0-dev`；与引擎 `0.158.0` 尚未对齐，留给 Python SDK 适配票处理 |

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
