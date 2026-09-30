# Windows x64 0.159.2 最终阶段 A 离线交付 / #16

本报告对应 [#16](https://github.com/immorcoding/codex-multiprovider/issues/16)，遵循
[#6 Windows 单引擎 amendment](https://github.com/immorcoding/codex-multiprovider/issues/6#issuecomment-5904845915)。
2026-09-30 本机集中验收通过：**Node 54/54、Python 2/2，零失败、取消或跳过**；
TypeScript `tsc --noEmit` 与 Python strict mypy 通过。#28–#33 已关闭。
本票从 main `942d1b1a00667baecef6ff8dc7be904f65c97c8e` 开始，分支
`codex/windows-delivery-0.159.2`，仅使用共享 local checkout。

## 可直接测试的产物

| 项目 | 实际核验值 |
| --- | --- |
| CLI 绝对路径 | `E:\Projects\codex\codex-rs\target\debug\codex.exe` |
| `--version` | `codex-cli 0.159.2` |
| binary SHA-256 | `23405b52983bfb275f50500ccea8821af0e9d5889197e3978f1300f45606bb41` |
| binary 大小 | 345316352 bytes |
| 唯一引擎 / 分支 | `E:\Projects\codex` / `codex/multiprovider-0.159.2` |
| tag / HEAD | `rust-v0.159.2` / `ff6aec96948b70d94983af2641a6b67c94faeff5` |
| patch tree | `1f419cca875711ec60c723b78eae465c8fa6a47c` |
| build source tree | `8657d695298d8affdb3bb7133dd2a90694a0ae12` |
| 实际源码 | 42 个补丁源码 blob + Cargo.lock = 43 个 build-source blob 全部一致；dirty 文件集合恰好为这 43 个路径 |
| 真实 index | 等于冻结 HEAD；没有暂存引擎改动 |
| Cargo.lock SHA-256 | `e85460a5c2a1f92d73ca0a40219c846f6a10d729f3186667485372c3aa82cfbf` |
| 唯一 target | `E:\Projects\codex\codex-rs\target`，复用原 debug 产物与缓存 |

四补丁顺序由 `config/binding-patches-0.159.json` 定义；本票没有修改补丁内容。

| 顺序 | 文件 | SHA-256 |
| --- | --- | --- |
| 1 | `patch/model-provider-routes-0.159.patch` | `d083daffc7f6efd33cfee28296dedafbb4902360af6e9242ea59ad89dafd27e8` |
| 2 | `patch/fork-provider-binding-0.159.patch` | `92341fd6a8fb85c35c4dc8320b4904998f3ff0dd040dc589cebb17d8431f36c0` |
| 3 | `patch/subagent-provider-binding-0.159.patch` | `c4b9bc2dbcf8e256ff036bab06897ae3d83566a9ece15f2f5e2668c0c543bc55` |
| 4 | `patch/parent-completion-0.159.patch` | `b138c131a34e3db554489130b6e4a5ab6e8bc815a368a941c825c79fdbfc5fa1` |

`verify-engine-artifact.mjs` 核验 tag/HEAD、分支、真实 index、完整 dirty 集合、实际 blobs、
有序 patch 应用生成的 tree、lock 和 binary。矩阵前后两次核验相同。
`--regenerate` 实际重生成四份 diff 后，文件字节与 tree 仍保持以上指纹。
没有 Cargo build/check/test/clean、release、stock 构建、额外 target/cache、clone、worktree，
没有复制引擎或大型缓存来包装产物，也没有改 Store 引擎、旧 `multiprovider-routing` 分支或用户 scratch。

## 默认安装入口与历史模式

```powershell
Set-Location E:\Projects\codex-multiprovider
# 已有 patched 源码：只检查冻结 HEAD 适用性，临时 index，无 Rust、无工作源码写入。
powershell -NoProfile -ExecutionPolicy Bypass -File tools/install-engine.ps1 -VerifyOnly -EnginePath E:\Projects\codex
node tools/binding-patches.mjs --engine E:\Projects\codex
# 当前已构建产物的真实源码/binary 核验：
node tools/verify-engine-artifact.mjs --engine E:\Projects\codex
& 'E:\Projects\codex\codex-rs\target\debug\codex.exe' --version
```

只有在**现有干净冻结源码**上才运行以下安装命令，本机已 dirty，故本票没有执行它：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/install-engine.ps1 -EnginePath E:\Projects\codex
# cmd wrapper 的等价入口：tools\install-engine.cmd -EnginePath E:\Projects\codex
```

默认应用全部四补丁，构建一个 debug CLI，target 固定在该 checkout 的 `codex-rs/target`。
无 EnginePath、错误 SHA、dirty 源码或歧义模式拒绝；不切换或重置现有 checkout。
`-CombinedPatch` 是显式别名。`-BaselineOnly` 是 stock 模式；`-BindingPatchesOnly`
只处理前三份且不构建，生成器对应 `--bindings-only`；`--parent-only` 独立检查第四份。
生成器默认四份组合，`--regenerate` 从 patch 输入重建 diff，不捕获额外 working source 改动。
历史 0.154 入口须显式 `-LegacyPatch`，历史 0.158 单路由须 `-RoutingPatch`，都拒绝本轮 SHA。
README 与 README.zh-CN 的首个交付入口同步；下方旧桌面流程明确标为历史。

TDD tracer：默认 installer 原先拒绝无模式 `-VerifyOnly`，修正后 1/1 green；
默认 generator 原先仅输出三个 binding patches，修正后输出四份及最终 tree，1/1 green。
显式三补丁、历史拒绝、dirty/错误 SHA、第四补丁损坏时不覆盖此前 diff 等门槛保留。

## 本机最终矩阵与复用的 Rust 范围

```powershell
Set-Location E:\Projects\codex-multiprovider
node tools/validate-windows.mjs E:\Projects\codex work/python-sdk/Scripts/python.exe
```

运行器要求 Windows x64，先核验产物，再执行语法、双 SDK 类型检查、八个 Node 测试文件、
Python mock，最后重核产物。缺少 checkout/binary/SDK 环境、任何失败或 skip 都不会报告成功。
每次日志写到新的 `work/issue16-validation-*`，不删除既有 scratch。完整矩阵只集中运行一次。
机器摘要见 [windows-delivery-validation-0.159.json](windows-delivery-validation-0.159.json)。

| 本机范围 | 实际结果 |
| --- | --- |
| baseline / installer / ordered patches / artifact drift / proxy regression | 21/21 passed |
| CLI `--version`、stdio app-server initialize | 1/1 passed；userAgent `baseline_probe/0.159.2 (Windows 10.0.22631; x86_64) unknown (baseline_probe; 0.1.0)`，platformFamily/Os 均为 windows |
| public routing / session / fork / subagent | 17/17 passed |
| GLM Responses tool loop / stream / errors / cancel | 11/11 passed |
| TypeScript SDK 0.159.2 public mock | 4/4 passed |
| 以上 Node 总计 | 54/54，70.400s，0 failed/cancelled/skipped/todo |
| TypeScript types | `tsc --noEmit` passed |
| Python SDK/runtime 0.159.2 types | strict mypy：1 source file，0 issues |
| Python synchronous public mock | 2/2 passed，4.22s，0 skipped |
| 语法 / workflow / whitespace | PowerShell parser、`node --check`、actionlint 1.7.7、`git diff --check` passed |
| 产物探测临时 HOME 整理后 | 仅重验 verifier、artifact guard 1/1 和语法，均通过；没有再跑整个矩阵 |

原始日志：`E:\Projects\codex-multiprovider\work\issue16-validation-7plRrU`。
独立核验实际 TS SDK 为 `0.159.2`，Python SDK/runtime 均 `0.159.2`；pytest `9.1.1`、mypy `2.3.1`。
Python 已安装发布元数据的 runtime 依赖确为 `openai-codex-cli-bin==0.159.2`。

模型路由保留显式冲突/未知 target 拒绝、未映射默认 mock、turn/settings、collaborationMode、
冷/loaded resume、默认与 route 变化、app-server/CLI fork 及持久 fork resume、子代理拒绝。
GLM 保留 `/api/v1/responses`、low/high/max、工具 call_id 与结果续轮、第二轮、缺尾、
字段 400、401/403/429/503、取消与脱敏。TS 保留流式/恢复/401/AbortSignal；
Python 保留 initialize/start/turn/stream、一次 completed、新进程 resume、fork、401 与 RPC 拒绝。

**父代理唤醒的公开 app-server seam 与 focused Rust 按相同指纹复用 #31 成功记录**，
没有计入上述新运行的 56 个 mock/轻量测试：

| #31 复用范围 | 成功记录 |
| --- | --- |
| core focused | 51/51，29.774s，0 retries；nextest `71e3cbc4-89cf-4a4c-a477-44d168669a6d`，2496 项被过滤 |
| public app-server parent completion | 7/7，14.743s，0 retries；nextest `61688da4-e311-4e2b-adc9-2fb076363882`，1369 项被过滤 |

该范围保留显式/role/system 子代理供应商、默认 role 不掩盖冲突、容量满保留邮件、nested residency、
detached 不重复、中断一次性通知，以及成功/错误/中断 × wake 开关、busy parent 无额外轮次、
关闭时下一用户轮次恰好处理一次排队结果。真实 HTTP input 断言见
[#31 报告](glm-responses-validation-0.159.md)与 [#31 机器记录](engine-validation-0.159.json)。

## 配置、model catalog 与双 SDK 复现

所有验收 fixture 只继承 Windows 进程启动所需环境，并为 HOME/USERPROFILE/APPDATA/
LOCALAPPDATA/CODEX_HOME 设置临时目录，关闭 plugins；HTTP 仅监听 `127.0.0.1`。
不继承真实 key、proxy 或用户 Codex 配置，假 key 不用于公网请求。

以下配置准备命令只写独立目录，不发起模型请求：

```powershell
$deliveryHome = 'E:\Projects\codex-multiprovider\work\delivery-home-0.159'
New-Item -ItemType Directory -Force -Path $deliveryHome | Out-Null
Copy-Item config/zai-models.json "$deliveryHome\models.json"
$catalogPath = "$deliveryHome\models.json".Replace('\', '/')
$snippet = Get-Content -Raw config/zai-coding-plan.config-snippet.toml
$content = "model_catalog_json = `"$catalogPath`"`n" + $snippet
[System.IO.File]::WriteAllText("$deliveryHome\config.toml", $content, [System.Text.UTF8Encoding]::new($false))
$env:CODEX_HOME = $deliveryHome
```

目录暴露 `glm-5.3-flash` 的 low/high/max，默认 max；配置映射到独立 `zai_coding_plan`，
Responses 基址保留 `/api/v1`。如需保留账户模型，把自己的 `models_cache.json` 放入该独立 HOME，
再执行 `node tools/merge-model-catalogs.mjs $deliveryHome "$deliveryHome\models.json" config/zai-models.json`。
此报告未读取账户目录或真实 key。在线调用仍留给按服务身份分别授权的 #17/#18。

复用现有 TS/Python 环境，以下命令走 loopback mocks：

```powershell
$env:CODEX_TEST_ROUTED_BINARY = 'E:\Projects\codex\codex-rs\target\debug\codex.exe'
npm run typecheck --prefix tools/sdk
npm test --prefix tools/sdk
work/python-sdk/Scripts/python.exe -m mypy --strict --cache-dir work/mypy-cache tools/sdk/python/public_api.py
work/python-sdk/Scripts/python.exe -m pytest -q tools/sdk/python/test_routing.py -p no:cacheprovider
```

TS 公开调用通过 `new Codex({ codexPathOverride: binary, env: isolatedEnv })` 选择该 CLI，
独立样例为 `tools/sdk/public-api.ts`。Python 使用 `Codex(CodexConfig(codex_bin=binary, env=isolatedEnv))`，
样例为 `tools/sdk/python/public_api.py`；实际 Python `env` 会合并父环境，mock fixture 同时隔离父环境。
首次安装精确公开版本的方法见 [TS 报告](typescript-sdk-validation-0.159.md)与
[Python 报告](python-sdk-validation-0.159.md)；本票直接沿用已安装环境。

## PR CI 与验收边界

自动 [patch-applies.yml](https://github.com/immorcoding/codex-multiprovider/actions/workflows/patch-applies.yml)
仅 Windows，pull_request 触发（亦可 manual），没有 push 双触发。覆盖默认/显式 installer、
版本记录、四补丁组合/独立适用性、语法、TS typecheck，以及明确标历史的 0.154/0.158 适用性。
CI 的 clean source 路径会实际应用四补丁，不构建 Rust、不运行 binary/mock；artifact-drift 反例
在错误 patch 摘要处拒绝，不依赖本机 binary。当前 PR 的精确 HEAD/checks/run 链接在 PR 描述与最终交付消息记录，
不把前序 PR 的绿灯当作当前结果。

[model-routing.yml](https://github.com/immorcoding/codex-multiprovider/actions/workflows/model-routing.yml)
只保留 workflow_dispatch；调用同一默认 installer 构建 debug CLI，保留缓存和并发取消，
运行 focused core、父代理公开 app-server、CLI/GLM mocks。**本票没有 dispatch 重型 CI**。
本机行为与 Rust 复用证据不等于 PR 自动 CI 覆盖。

阶段 A 离线交付完成；GLM 真实在线、Coding Plan 凭据资格与普通按量服务身份均未验证，
真实/收费模型 API 请求为 **0**，#17/#18 保持 open。未验 Python AsyncCodex 对等、全部 SDK API、
Python 父/子代理策略或默认 stock runtime 行为；不宣称 Store 或默认 SDK 分发包内置补丁。
0.154/0.158 旧源码、补丁与报告均仅为历史证据；本轮无 Linux 可用承诺。

The default Windows entry points now target the frozen 0.159.2 four-patch debug delivery.
The final local matrix passes 54 Node tests and two synchronous Python tests with no skips,
plus TypeScript and strict Python type checks. Exact source, index, lock, patches and binary
fingerprints match #31 before and after the run, permitting reuse of its 51 core and seven
public app-server parent-completion tests. Automatic PR CI is lightweight Windows validation;
heavy Rust remains manual and was not dispatched. All provider requests were loopback mocks
with fake keys. Real GLM/credential eligibility, async Python parity, Python parent/subagent
policy, stock SDK runtimes and Store integration remain outside this acceptance.
