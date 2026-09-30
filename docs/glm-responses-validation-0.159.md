# 0.159 Windows 组合引擎与 GLM 离线复验 / #31

本报告对应 [#31](https://github.com/immorcoding/codex-multiprovider/issues/31)，
执行范围遵循 [#6 的 Windows/单引擎修订](https://github.com/immorcoding/codex-multiprovider/issues/6#issuecomment-5904845915)。
**Windows x64 本机验收通过。** 父代理复验发现并修复了 wake 关闭时的旧邮件消费问题；
修复后的 CLI 重建、core 51 项、app-server 7 项和公开 mock 29 项均通过。
交付与后续复用使用下方最终指纹。

## 源码与构建环境

- 项目起点：`78a8b1e5e88f21a78d8126f0c631a5b2e2061016`（PR #36 后的 main）；实现分支 `codex/glm-responses-0.159`。
- 唯一引擎：`E:\Projects\codex`，分支 `codex/multiprovider-0.159.2`；冻结 HEAD `ff6aec96948b70d94983af2641a6b67c94faeff5`，tag `rust-v0.159.2`。
- 四补丁顺序：routes → fork → subagent → parent，由 `config/binding-patches-0.159.json` 定义。
- 初始组合 tree：`e5c4b382f88e631c7033260a1ea93609f15380b9`。构建前逐一核对 42 个 dirty 源码 blob（38 tracked + 4 新增）；真实 index 与冻结 HEAD 一致。
- 唯一 target：`E:\Projects\codex\codex-rs\target`，现有普通目录，非 link；没有配置另一个 target，命令明确设置 `CARGO_TARGET_DIR`。保留 debug/增量缓存。
- Windows x64 / MSVC；Rust/Cargo `1.95.0`；just `1.58.0`；cargo-nextest `0.9.146`；VS C++ tools 位于 `E:\Microsoft Visual Studio`。
- 开始前 E 盘空闲 `186448908288` 字节（约 173.6 GiB），未发现 cargo/rustc 进程。

没有新 clone/worktree、stock CLI、release、cargo clean、workspace 全量 Rust 测试或并行远程重型构建。
引擎 HEAD/index 不提交、不重置；原 `multiprovider-routing` 分支、`work/asar-tools` 与 `/work/` exclude 保留。

## 验收命令

```powershell
$env:CARGO_TARGET_DIR = 'E:\Projects\codex\codex-rs\target'
Set-Location E:\Projects\codex\codex-rs
cargo build -p codex-cli --bin codex
Set-Location E:\Projects\codex
just test -p codex-core --lib --test-threads=1 --retries=0 -E 'test(spawn_agent_) | test(multi_agent_v2_completion_) | test(multi_agent_v2_detached_) | test(multi_agent_v2_interrupted_) | test(completion_keeps_mail_queued_) | test(residency_keeps_nested_)'
just test -p codex-app-server --test all --test-threads=1 --retries=0 -E 'test(parent_completion_wake)'
Set-Location E:\Projects\codex-multiprovider
$env:CODEX_TEST_ROUTED_BINARY = 'E:\Projects\codex\codex-rs\target\debug\codex.exe'
node --test --test-concurrency=1 tools/engine-initialize.test.mjs tools/model-routing.test.mjs tools/glm-responses.test.mjs
```

本机命令在获得执行权限的正常环境运行；sandbox 身份下 Git ownership 检查与 gh keyring 不可用。
Git 仅对这一引擎按命令设置 `safe.directory=E:/Projects/codex`，不改全局信任或账号配置。
公开 mock 运行器只继承 Windows/进程启动所需环境，并为 USERPROFILE/HOME/APPDATA/LOCALAPPDATA 设置隔离目录；
不继承用户 API key、代理或 CODEX 配置变量。每个 fixture 再设置独立临时 `CODEX_HOME`、假 key 与 `127.0.0.1` HTTP 服务。

## 结果

| 范围 | 实际结果 |
| --- | --- |
| 首次四补丁 debug CLI | 成功，`dev` profile，7m 20s；没有 check 前置构建或重复 stock 构建 |
| 修复后增量 CLI | 成功，1m 27s，同一 `dev` profile/target/cache |
| 修复后 core focused | 51/51 passed，29.774s；增量测试构建 1m 45s；2496 项由过滤器排除，选中项没有失败或重试 |
| CLI `--version` 与 initialize | `codex-cli 0.159.2`，stdio initialize 成功；1/1 |
| 公开模型路由/绑定 | 17/17 passed |
| GLM Responses | 11/11 passed |
| 修复后公开三文件合计 | 29/29 passed，64.943s，0 failed / cancelled / skipped |
| app-server `all` / `parent_completion_wake` | 修复后 7/7 passed，14.743s，0 retries；测试增量构建 36.28s，1369 项被过滤 |
| 相关轻量与语法 | 票末 18/18 passed，19.820s；第四补丁修复后只重验受影响文件 6/6 passed，4.696s；均 0 skipped；语法与 whitespace 检查通过 |

core 选中项包括显式、role 与系统默认子代理模型的拒绝/同供应商成功，
默认 role 不能掩盖跨供应商显式选择，nested-parent residency、容量满时保留完成邮件、
detached watcher 不重复投递、中断终结一次性投递，以及 busy/queue-only 父代理的 durable sleep 不被间接唤醒。

公开模型路由覆盖配置默认/显式模型、未知 target/冲突、未映射模型使用默认 OpenAI mock，
同供应商 turn/settings、跨供应商和未映射更新拒绝、`collaborationMode` 的有效模型优先级，
loaded/cold resume、默认/route 变化、CLI/app-server fork 及持久 fork resume、CLI/app-server 子代理拒绝。
`collaborationMode` 拒绝用例同时断言没有向另一供应商外发请求。

GLM 覆盖 Coding Plan 路由与最终 `/api/v1/responses`、目录中的 low/high/max（默认 max）、
文本先于终结事件流出、真实固定 echo 工具的 `call_id` 结果续轮、第二轮保持供应商与历史，
缺少 `response.completed`、字段拒绝 400、401/403/429/503、流式取消与诊断脱敏。
直接 Responses 契约通过，没有新增引擎兼容适配，没有删除、放宽或 skip 关键断言。
额外复核一个 OpenAI mock 用例：在运行器没有注入 API key 的环境中仍通过，不依赖用户凭据。

### 产物指纹

机器可读交接为 [engine-validation-0.159.json](engine-validation-0.159.json)。
前三补丁保持 #30 原值；第四补丁显式捕获本票的两处源码变更，未重新安装或应用旧输入 patch。

- CLI：`E:\Projects\codex\codex-rs\target\debug\codex.exe`，`345316352` 字节。
- binary SHA-256：`23405b52983bfb275f50500ccea8821af0e9d5889197e3978f1300f45606bb41`。
- patch-only tree：`1f419cca875711ec60c723b78eae465c8fa6a47c`。
- 构建源码 tree（包含正常刷新的 Cargo.lock）：`8657d695298d8affdb3bb7133dd2a90694a0ae12`。
- Cargo.lock 文件 SHA-256：`e85460a5c2a1f92d73ca0a40219c846f6a10d729f3186667485372c3aa82cfbf`。
- `--version`：`codex-cli 0.159.2`；实际 initialize userAgent：`issue31-fingerprint/0.159.2 (Windows 10.0.22631; x86_64) unknown (issue31-fingerprint; 1)`。

Cargo.lock 唯一变化是 159 个本地 package 的 `0.0.0` → `0.159.2`（159 additions / 159 deletions）；
依赖与 checksum 没有变化，没有硬编码历史版本。该锁文件保持在引擎 dirty 工作源码，
不纳入补丁或提交引擎。构建源码 tree 用临时 index 从 patch tree 加这一个 lock blob 生成，
不改真实 index。初始与最终分别核对 42 个 patch 源码 blob，与各自组合 tree 一致。

构建保留三条非致命警告：`thread_manager.rs` 的 `InterAgentWakePolicy`、
`tools/registry.rs` 的 `ToolCallSource` 未使用，`input_queue.rs::enqueue_mailbox_communication` 未调用。
没有为了清理警告扩展修改或触发额外引擎构建。

### 失败与修复

首次 app-server focused：5 passed / 2 failed（21.431s），失败为 `completed_queued` 和 `errored_queued`，
nextest 的默认重试也失败。最小复现是同一公开 `all` binary 中仅运行 `completed_queued`，`--retries=0`。
实际第二轮 HTTP input 含新用户消息，却没有 `Message Type: FINAL_ANSWER`，mock 返回 404，最终一次性断言为 0 而非 1。

`start_task` 已从 mailbox 领取旧邮件并放入 pending input，但首次终结回复会将 queue-only mail 延后。
本票在 `tasks/mod.rs::start_task` 仅对普通任务将**任务开始前已经排队**的邮件追加到 initial input；
因此父代理的下一轮从初始 context 就可见该结果，用户输入仍在前。
任务开始后到达的邮件继续保持上游的 defer/steering 行为；review/shell 任务保持原路径。
仅改 wake phase 无法解决终结回复的再次 defer，该尝试没有进入最终补丁。

公开 Rust 测试保留成功/错误/中断 × 开关及 busy/no-extra-turn 条件，并加强：
从 `received_responses_requests` 的真实 HTTP input 计数，而非记录匹配尝试的 `ResponseMock`；
所有路径断言恰好一个 completion request、一个 envelope 与预期 payload，明确要求手动处理和中断唤醒轮次成功。
没有用额外 mock 回复、放宽一次性断言或跳过测试来凑绿。

修复只涉及第四补丁范围的 `core/src/tasks/mod.rs` 与 `app-server/tests/suite/v2/parent_completion_wake.rs`。
显式用临时 index 从原组合 tree 更新这两个 blob，重写第三阶段 tree → 新组合 tree 的第四份 diff；
生成器的 `--regenerate` 只读输入 patch，本票没有误用它来捕获 dirty source。
修复后 patch tree 为 `1f419cca875711ec60c723b78eae465c8fa6a47c`，第四补丁 SHA-256 为
`b138c131a34e3db554489130b6e4a5ab6e8bc815a368a941c825c79fdbfc5fa1`。

## 证据边界与复用

GLM 证据只适用于离线 Coding Plan Responses mock：直连最终 `/api/v1/responses`，不经 DeepSeek 转换。
没有索取密钥或调用任何真实/收费模型 API；普通按量服务身份不继承 Coding Plan 的证据。
`gpt-6.1-sol` 只作为未映射模型在 OpenAI loopback mock 上验证，不证明在线可用。
#17/#18 的在线授权与适用凭据仍待用户决定；SDK 升级与公开 API 验收留 #32/#33。

PR 自动 CI 仅 Windows 轻量语法/版本/适用性；本报告的 Rust 与公开行为证据来自本机。
没有 dispatch 手动重型 workflow。后续 #32/#33/#16 只有在冻结 SHA、四补丁、实际源码、lock 与 binary 指纹一致时才能复用此产物；
影响引擎的修复需要增量构建并重验受影响行为。
