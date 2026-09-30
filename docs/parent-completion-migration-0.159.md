# 0.159 父代理完成通知迁移 / #30

本文保留 #30 的迁移交接快照和当时的指纹。#31 已完成运行时复验并修复第四补丁，
当前共享源码、第四补丁与 binary 以[最终验收交接](glm-responses-validation-0.159.md)为准；
下方旧组合 tree 与第四补丁 SHA 不作为修复后的复用指纹。

**diff/适用性完成，组合运行时待31。** Windows x64，仅复用 `E:\Projects\codex`，
分支 `codex/multiprovider-0.159.2`，HEAD 保持 `ff6aec96948b70d94983af2641a6b67c94faeff5`。
没有 Cargo check/build/test、CLI 行为套件、SDK 升级或真实 API 调用。
本机源码已经含四份补丁，#31 直接增量构建，不能重新安装、reset、clean 或再 clone。

## 四补丁顺序和指纹

安装、生成、轻量 CI 和 manual 重型 CI 都读取 `config/binding-patches-0.159.json`。
原三份文件字节保持 #29 指纹；历史 `parent-completion.patch` 保持不变。

| 顺序 | 文件 | SHA-256 |
| --- | --- | --- |
| 1 | `patch/model-provider-routes-0.159.patch` | `d083daffc7f6efd33cfee28296dedafbb4902360af6e9242ea59ad89dafd27e8` |
| 2 | `patch/fork-provider-binding-0.159.patch` | `92341fd6a8fb85c35c4dc8320b4904998f3ff0dd040dc589cebb17d8431f36c0` |
| 3 | `patch/subagent-provider-binding-0.159.patch` | `c4b9bc2dbcf8e256ff036bab06897ae3d83566a9ece15f2f5e2668c0c543bc55` |
| 4 | `patch/parent-completion-0.159.patch` | `dfe4f999f9604af3feaa22641747b166366cacb1ce3006957665157fcbbd977a` |

三补丁 tree：`4657c685092fec7b1d83c4e7888585d9e95ea8f2`。
第四份单独从冻结 SHA 应用：`4d37664f2fd0b462d561fde8bff9fa4b27ec8a39`。
四份组合结果：`e5c4b382f88e631c7033260a1ea93609f15380b9`。
临时 index 使用 `apply --cached --check` 后应用并 `write-tree`，不创建 checkout 或 commit。

```powershell
# 当前 dirty 源码可用；仅验证冻结 HEAD 上补丁适用性，不宣称 working source 已核验。
./tools/install-engine.ps1 -CombinedPatch -VerifyOnly -EnginePath E:\Projects\codex
node tools/binding-patches.mjs --engine E:\Projects\codex --parent-only
node tools/binding-patches.mjs --engine E:\Projects\codex --combined
# 重生成不读取 working source，只重建记录中的四份 patch；全预检通过后才写文件。
node tools/binding-patches.mjs --engine E:\Projects\codex --combined --regenerate
```

`-BindingPatchesOnly` 仍只处理前三份且不构建；组合 `--apply` 要求 clean source，
先完成全部临时 index 预检再按顺序 check/apply。
`-CombinedPatch` 不加 `-VerifyOnly` 要求 clean source，应用四份后构建一次 debug CLI，
只供新安装使用。本机交接源码已经 dirty，该入口会拒绝，不允许丢弃已有改动来使用它。

## 实际生命周期与 steering 映射

对照旧基线 `064c6b8c737f5b41d171fdda80bd9ef10ad06eb3` 与冻结 0.159 源码：

- `session/mod.rs::send_event` 仍在 terminal event 后调用 `maybe_notify_parent_of_terminal_turn`。
  完成/错误与中断统一交给 `AgentControl::turn_finished`；新的共享 `TurnContext::parent_completion_sent`
  防止同一轮及派生 context 重复回调再次投递。每轮新 context 独立初始化，不阻止后续轮完成。
- `agent/control/completion.rs` 仍负责 direct-parent 路由。开关由子代理有效 turn config 捕获，
  容量准入失败仍投递结果，只选 `CompletionQueueOnly`，不把容量失败变成丢信。
- `session/handlers.rs::inter_agent_communication` 在 `active_turn` 锁内检查空闲并入 mailbox。
  `CompletionIfIdle` 只在该检查时无 active/reserved turn 才设 trigger；运行中不留下后续自动轮次。
  普通消息使用 `Default`，保留既有 trigger 与 durable-sleep 行为。
- `session/input_queue.rs` 保存 completion wake policy；`tasks/mod.rs` 的 durable-sleep 准入只由普通
  消息触发。因此开关关闭、容量不足或运行中到达的完成结果不会间接唤醒睡眠父代理，邮件仍保留。
- `agent/control.rs` 的 detached legacy watcher 跳过 loaded MAv2 子代理；实际 spawn/resume 在
  `agent/control/spawn.rs` 原有 `multi_agent_version != V2` 条件下才注册 watcher。
  MAv2 的终结生命周期负责投递，不由 legacy watcher 补送第二条。
- 原 0.159 `session/turn_input.rs::{start,steer}`、`input_queue.rs::watch_user_input` 和
  `session/mod.rs::capture_step_context` 的 InstantInterrupt preemption 不被覆盖。
  `tasks/mod.rs::{abort_turn_if_active,finish_turn_abort,on_task_finished}` 的 `TurnAbortedEvent.error`
  与清理逻辑保持；只调整 pending-work 的睡眠准入条件。
- 保留旧补丁的 nested-parent residency/pin 防止尚有 resident child 的 parent 被驱逐、丢失 mailbox。
  `ConfigToml`、config/schema 和所有 `Op::InterAgentCommunication` 构造同步；没有硬编码 CLI 版本。

生产逻辑约 200 行；较大的 diff 主要是移植原公开 JSON-RPC 测试和机械同步 Op 构造，
历史测试证据不计本轮运行时通过。

## 验证范围及 #31 入口

安装器 seam 已跑红→绿：组合 verify 从占位拒绝变为四份成功，真实 index/source 状态不变。
轻量用例覆盖独立父补丁、错误顺序、第四补丁损坏时不覆盖前三份 diff、dirty 拒绝与版本继承。
Rust 用例移植并扩展，只有 rustfmt 解析/格式检查；没有运行或编译，不能声称 Rust 红→绿。
本机票末 serial 轻量 suite 18/18 通过（baseline、binding/combined installer、proxy transforms），
PowerShell/JavaScript 语法、actionlint 1.7.7、33 个第四补丁 Rust 文件 rustfmt check 和两个仓库
`git diff --check` 通过。重生成四补丁后指纹未变；42 个实际 dirty 源码 blob 均与组合 tree 一致，
真实 index 条目和冻结 HEAD 均与执行前一致。stable rustfmt 仅提示 nightly imports_granularity 配置不可用。

留给 #31 的 focused core 目标涵盖 `spawn_agent_`、`multi_agent_v2_completion_`、
`multi_agent_v2_detached_`、`multi_agent_v2_interrupted_`、`completion_keeps_mail_queued_`、
`residency_keeps_nested_`。app-server 目标 `parent_completion_wake`（integration binary `all`）
涵盖成功/错误/中断 × wake 开关、busy parent 不开第二轮，InstantInterrupt 开启时的中断路径，
及模型可见 completion 恰好一次。两目标均使用 `just test` / nextest，单线程、相同 debug target。

```powershell
# 已应用四patch的唯一源码；复用现有E盘 target/cache，Cargo.lock 的本地版本正常刷新。
Set-Location E:\Projects\codex\codex-rs
cargo build -p codex-cli --bin codex
Set-Location E:\Projects\codex
just test -p codex-core --lib --test-threads=1 -E 'test(spawn_agent_) | test(multi_agent_v2_completion_) | test(multi_agent_v2_detached_) | test(multi_agent_v2_interrupted_) | test(completion_keeps_mail_queued_) | test(residency_keeps_nested_)'
just test -p codex-app-server --test all --test-threads=1 -E 'test(parent_completion_wake)'
Set-Location E:\Projects\codex-multiprovider
$env:CODEX_TEST_ROUTED_BINARY = 'E:\Projects\codex\codex-rs\target\debug\codex.exe'
node --test tools/model-routing.test.mjs tools/engine-initialize.test.mjs tools/glm-responses.test.mjs
```

`model-routing.yml` 已 retarget 同一冻结记录与四patch顺序，只允许 workflow_dispatch，
缓存 debug target，两个 focused Rust 目标及公开 mock 使用同一源码/产物；没有先 check 再 build。
自动 PR CI 只有 Windows 轻量检查，未增加 push、Linux 或逐 PR 重型编译。
双 SDK 仍留 #32/#33，mock/真实服务身份能力未在本票验收。

## 唯一引擎 dirty 交接

真实 index 保持基线，38 tracked 修改 + 4 新增源码；保留 `.git/info/exclude` 的 `/work/`
及 `work/asar-tools`，不修改 Cargo.toml/Cargo.lock。下列完整清单供 #31 核对：

```text
M codex-rs/app-server/src/request_processors.rs
M codex-rs/app-server/src/request_processors/thread_processor.rs
M codex-rs/app-server/src/request_processors/turn_processor.rs
M codex-rs/app-server/tests/suite/v2/mod.rs
M codex-rs/config/src/config_toml.rs
M codex-rs/core/config.schema.json
M codex-rs/core/src/agent/api.rs
M codex-rs/core/src/agent/child_config.rs
M codex-rs/core/src/agent/control.rs
M codex-rs/core/src/agent/control/completion.rs
M codex-rs/core/src/agent/control/residency.rs
M codex-rs/core/src/agent/control/residency_tests.rs
M codex-rs/core/src/agent/control/spawn.rs
M codex-rs/core/src/agent/control_tests.rs
M codex-rs/core/src/config/config_tests.rs
M codex-rs/core/src/config/mod.rs
M codex-rs/core/src/session/handlers.rs
M codex-rs/core/src/session/input_queue.rs
M codex-rs/core/src/session/mod.rs
M codex-rs/core/src/session/review.rs
M codex-rs/core/src/session/tests.rs
M codex-rs/core/src/session/turn_context.rs
M codex-rs/core/src/session_prefix.rs
M codex-rs/core/src/tasks/mod.rs
M codex-rs/core/src/thread_manager.rs
M codex-rs/core/src/tools/handlers/multi_agents_tests.rs
M codex-rs/core/tests/suite/agent_execution.rs
M codex-rs/core/tests/suite/compact_remote.rs
M codex-rs/core/tests/suite/models_cache_auth.rs
M codex-rs/core/tests/suite/pending_input.rs
M codex-rs/core/tests/suite/pending_input_persistence.rs
M codex-rs/core/tests/suite/scenarios_mailbox_preemption_tests.rs
M codex-rs/core/tests/suite/subagent_notifications.rs
M codex-rs/core/tests/suite/subagent_service_tier.rs
M codex-rs/core/tests/suite/turn_input_submission.rs
M codex-rs/exec/src/lib.rs
M codex-rs/exec/src/lib_tests.rs
M codex-rs/protocol/src/protocol.rs
?? codex-rs/app-server/src/request_processors/session_provider_binding.rs
?? codex-rs/app-server/tests/suite/v2/parent_completion_wake.rs
?? codex-rs/core/src/session/parent_completion_tests.rs
?? codex-rs/exec/src/resume_model_selection.rs
```
