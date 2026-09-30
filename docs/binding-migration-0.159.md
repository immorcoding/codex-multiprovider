# 0.159 路由与供应商绑定迁移 / #29

本文保留 #29 的迁移快照；三份绑定补丁指纹未变。#31 的组合运行时复验和修复后第四补丁/CLI
交接见[最终验收报告](glm-responses-validation-0.159.md)，不将本票关闭本身当作行为通过。

**diff/适用性完成，组合运行时待31。** 仅 Windows x64，冻结引擎
`ff6aec96948b70d94983af2641a6b67c94faeff5`（`rust-v0.159.2`）。
0.158 的原补丁、固定 SHA 和历史报告保持不变；它们不计本轮行为通过。

## 三份补丁与唯一源码交接

统一顺序由 `config/binding-patches-0.159.json` 定义；安装、生成与 CI 使用同一份记录。
#30 已在该记录追加第四份父代理补丁，当前唯一源码状态与四补丁指纹以
[父代理迁移交接](parent-completion-migration-0.159.md)为准。下文三补丁 tree 与 dirty 清单是 #29 的交接快照。

| 顺序 | 补丁 | SHA-256（文件字节） |
| --- | --- | --- |
| 1 | `patch/model-provider-routes-0.159.patch` | `d083daffc7f6efd33cfee28296dedafbb4902360af6e9242ea59ad89dafd27e8` |
| 2 | `patch/fork-provider-binding-0.159.patch` | `92341fd6a8fb85c35c4dc8320b4904998f3ff0dd040dc589cebb17d8431f36c0` |
| 3 | `patch/subagent-provider-binding-0.159.patch` | `c4b9bc2dbcf8e256ff036bab06897ae3d83566a9ece15f2f5e2668c0c543bc55` |

本机 `E:\Projects\codex`、分支 `codex/multiprovider-0.159.2` 已按此顺序逐份
`git apply --check` / `git apply`。HEAD 仍为冻结 SHA，**源码 dirty 是这三份补丁的结果**，
没有 engine commit、reset、第二个 checkout/worktree、Cargo build/check/test 或 clean。
结果 Git tree 为 `4657c685092fec7b1d83c4e7888585d9e95ea8f2`，可作为 #30 的第四份 diff 基准。
引擎 index 保持基线；dirty tracked 文件共 10 个：

```text
codex-rs/app-server/src/request_processors.rs
codex-rs/app-server/src/request_processors/thread_processor.rs
codex-rs/app-server/src/request_processors/turn_processor.rs
codex-rs/config/src/config_toml.rs
codex-rs/core/config.schema.json
codex-rs/core/src/agent/child_config.rs
codex-rs/core/src/config/mod.rs
codex-rs/core/src/tools/handlers/multi_agents_tests.rs
codex-rs/exec/src/lib.rs
codex-rs/exec/src/lib_tests.rs
```

新增、尚未跟踪的源码文件为
`codex-rs/app-server/src/request_processors/session_provider_binding.rs` 和
`codex-rs/exec/src/resume_model_selection.rs`。保留 `.git/info/exclude` 的 `/work/` 及旧分支。
#30 继续在此源码上迁移父代理完成补丁；核对这三份指纹再开始，不能丢弃已有 diff。

## 生成与适用性入口

```powershell
# 干净冻结源码：逐份预检，工作树不变，无 Rust
powershell -NoProfile -ExecutionPolicy Bypass -File tools/install-engine.ps1 -BindingPatchesOnly -VerifyOnly -EnginePath E:\Projects\codex
# 干净冻结源码：预检全部补丁后逐份 check/apply；不构建部分 CLI
powershell -NoProfile -ExecutionPolicy Bypass -File tools/install-engine.ps1 -BindingPatchesOnly -EnginePath E:\Projects\codex
# 使用 HEAD 的临时 Git index 重建每一阶段的完整 blob 指纹和 diff
node tools/binding-patches.mjs --engine E:\Projects\codex --regenerate
```

生成器将记录中的补丁作为输入，基于冻结 HEAD 逐份 `apply --cached --check`、应用并生成
相邻 tree 的 diff；它不会捕获额外的 working tree 修改，也不会更改真实 index/工作源码。
只创建临时 index 与 Git tree/blob 对象，不创建 checkout/commit。`--series` 可指向同名
三补丁的替代输入记录；顺序错误先拒绝。全部预检通过后才写回 diff 或开始实际应用。
安装器要求现有 checkout、准确 SHA 和 clean source；当前交接源码已 dirty，因此不要重新安装。
dirty 源码上可直接运行生成器的默认检查，它检查冻结 HEAD 上的补丁适用性，不证明当前 working tree 内容。
历史 `sync-to-public.ps1` 仍服务旧整体补丁；新版三补丁使用此独立生成入口。

在 #29 交接时，`-CombinedPatch` 尚未接通；#30 已接通第四补丁与组合入口并 retarget manual CI。
本票只在已有 Windows 0.159 轻量 job 接通三补丁检查/应用；历史 0.154/0.158 job 仍用旧固定 SHA，
`model-routing.yml` 仍为手动触发的历史 0.158 重型验证，不视为新版组合通过。

## 实际 0.159 接口映射

与 `064c6b8c737f5b41d171fdda80bd9ef10ad06eb3` 比较过相关源码。变化包括
exec 的 `ExecServerRuntimePaths` → `ExecServerRuntimeOptions`、thread store item anchor 分页、
archive 前持久化、Guardian circuit-break 配置与 schema；新 diff 保留这些上游变化。
child 配置和共享 settings builder 的接口在两基线间保持一致，因此复用原有逻辑而重建 diff。

| 公开行为 | 0.159 落点与拒绝条件 | 留给 #31 的验证 |
| --- | --- | --- |
| start / exec 路由 | `config/src/config_toml.rs`、`core/src/config/mod.rs`：校验所有 route target，显式冲突失败；未映射使用默认供应商 | `tools/model-routing.test.mjs`：显式/配置默认模型、未知 target、冲突、exec；增加未映射 `gpt-6.1-sol` 的 OpenAI mock 路径 |
| 冷恢复与 loaded resume | `session_provider_binding.rs`、`thread_processor.rs`：stored thread / metadata / rollout 恢复绑定，显式 model/provider 更新不能跨绑定 | 同套公开测试的冷恢复、默认变化、route 变化、loaded resume 用例 |
| turn / settings | `turn_processor.rs::build_thread_settings_overrides` 共用边界，按实际有效模型检查；`collaborationMode` 的模型优先于单独 model，与 `StepSettings::apply` 一致 | 同供应商成功、跨供应商/未映射拒绝；增加 collaboration mode 的拒绝用例，检查无外发请求 |
| exec resume / fork | `exec/src/lib.rs` 的 `ResumeModelSelection` 只传显式 CLI 选择，不把当前配置默认值当 override | 同套公开 exec resume/fork 用例；`exec/src/lib_tests.rs` 调用接口已同步 |
| app-server fork / 持久恢复 | `thread_processor.rs`：默认继承 source model/provider，配置加载后核对来源绑定 | 同套公开 fork 同供应商/跨供应商、默认变化、fork resume 用例 |
| 子代理显式 / role / 系统默认 | `core/src/agent/child_config.rs::prepare_agent_spawn_config`：显式及系统默认模型在 role 替换前检查，role 应用后再次检查；继承父供应商 | 同套 CLI/app-server subagent mock；focused `spawn_agent_rejects_cross_provider_models_from_each_selection_source`、`spawn_agent_rejects_cross_provider_request_even_when_default_role_would_replace_it`、`spawn_agent_executes_same_provider_models_from_each_selection_source` |

## 版本与实际检查

冻结源码的 `[workspace.package].version` **已经是 `0.159.2`**；CLI `version.workspace = true`。
`Cargo.lock` 中本地 `codex-cli` 仍为 `0.0.0`。上游发布流程允许 tag bump workspace 而不改 lock，
构建时刷新本地包版本（见上游 `.github/workflows/rust-release.yml` 的 workspace-version 注释）。
本票不改 Cargo.toml/Cargo.lock，不把旧 `0.154.0` pin 带入补丁；#31 的一次 debug 构建负责正常更新 lock，
随后以 `tools/engine-initialize.test.mjs` 验证 `--version` 与 initialize，不能把源码轻量检查当 binary 证据。

本机已完成：15 项 serial 轻量测试（baseline、binding installer/preflight、proxy transforms），
PowerShell/JavaScript 语法，actionlint v1.7.7，仓库与引擎 `git diff --check`，
四个相关 Rust 文件的 rustfmt 解析/格式检查，以及三份补丁的实际按序 check/apply。
rustfmt stable 对上游 nightly `imports_granularity` 发出提示，检查返回成功。
未运行 Cargo、CLI、公开模型路由行为套件、SDK 或真实 API；新增行为用例仅检查语法。

#31 设置 `CODEX_TEST_ROUTED_BINARY` 指向四补丁组合的唯一 debug CLI，再运行
`node --test tools/model-routing.test.mjs tools/engine-initialize.test.mjs` 与 GLM 离线闭环和必要 focused Rust 测试。
本票不对在线模型能力或服务身份兼容作通过声明。
