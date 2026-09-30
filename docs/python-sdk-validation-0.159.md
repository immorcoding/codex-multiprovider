# Python SDK/runtime 0.159.2 Windows 离线验收 / #33

本报告对应 [#33](https://github.com/immorcoding/codex-multiprovider/issues/33)，遵循
[#6 Windows/单引擎修订](https://github.com/immorcoding/codex-multiprovider/issues/6#issuecomment-5904845915)。
**公开 Python SDK/runtime 0.159.2 的 Windows x64 同步离线验收通过。**
项目起点 `ceca83ade073ca283d8168e860d2c8d0113eb667`，分支 `codex/python-sdk-0.159.2`。
验收日期为 2026-09-30；仅复用本地共享 checkout 与唯一 patched CLI。

## 真实公开安装与类型

- 环境：`E:\Projects\codex-multiprovider\work\python-sdk`，CPython `3.12.7`，uv `0.12.15`。
  沿用既有环境，没有删除用户环境；uv 缓存放在项目 `work/uv-cache`，没有在 C 盘新建大缓存。
- `requirements.txt` 精确固定 `openai-codex==0.159.2` 和 `openai-codex-cli-bin==0.159.2`；
  pytest `9.1.1`、mypy `2.3.1` 不变。公开 PyPI 安装只替换这两个 0.158.0 包。
- 实际 `importlib.metadata.version`：SDK `0.159.2`、runtime `0.159.2`。
  SDK 的实际 `Requires-Dist` 为 `pydantic>=2.12`、`packaging>=26.2`、
  **`openai-codex-cli-bin==0.159.2`**；runtime 无 `Requires-Dist`。
  元数据分别位于环境 `Lib/site-packages/openai_codex-0.159.2.dist-info/METADATA` 与
  `Lib/site-packages/openai_codex_cli_bin-0.159.2.dist-info/METADATA`。
- 冻结 tag 的 `sdk/python/pyproject.toml` 实际仍为 `0.0.0-dev`、runtime `0.153.4`；
  本票不以它们代替发布版本。stock runtime 位于环境 `Lib/site-packages/codex_cli_bin/bin/codex.exe`，
  不含本仓库补丁，明确不用于本次行为验收。
- `public_api.py` 保持独立公开接口类型样例：`Codex`、`CodexConfig`、`Sandbox`、
  `TurnCompletedNotification`、`TurnStatus`，以及 start/turn/stream/resume/fork/run 签名。
  strict mypy 使用实际发布包，1 个 source file 通过。
- 没有发现独立 SDK/schema 缺陷，没有修改 SDK 源码、发布包或引擎源码，没有添加 schema 适配。
  `metadata.userAgent`、枚举状态与两类公开错误均符合现有契约。
  官方 [app-server 文档](https://learn.chatgpt.com/docs/app-server) 用于核对公开 initialize、
  thread/turn 与通知流程；精确版本证据来自实际安装元数据与本机执行。

## 实际核对的复用指纹

先完整读取 #31 的 [机器记录](engine-validation-0.159.json) 和
[源码/行为报告](glm-responses-validation-0.159.md)，再实际核对以下各项。

| 项目 | #33 实际结果 |
| --- | --- |
| 唯一引擎 / 分支 | `E:\Projects\codex` / `codex/multiprovider-0.159.2` |
| HEAD 与 tag `rust-v0.159.2` | `ff6aec96948b70d94983af2641a6b67c94faeff5` |
| 真实 index | 与冻结 HEAD 一致，`git diff --cached` 为空 |
| patch tree | `1f419cca875711ec60c723b78eae465c8fa6a47c` |
| build source tree | `8657d695298d8affdb3bb7133dd2a90694a0ae12` |
| patch 源码 | 42 个实际 `git hash-object` 均等于 patch tree blob；dirty 文件集合恰好为这 42 个文件加 Cargo.lock |
| Cargo.lock SHA-256 | `e85460a5c2a1f92d73ca0a40219c846f6a10d729f3186667485372c3aa82cfbf`；blob 与 build tree 一致，build tree 相对 patch tree 仅含这一 lock 变化 |
| 实际 CLI | `E:\Projects\codex\codex-rs\target\debug\codex.exe`，`345316352` 字节 |
| CLI `--version` | `codex-cli 0.159.2` |
| CLI SHA-256 | `23405b52983bfb275f50500ccea8821af0e9d5889197e3978f1300f45606bb41` |

| 有序补丁 | 实际 SHA-256，与 #31 相同 |
| --- | --- |
| `model-provider-routes-0.159.patch` | `d083daffc7f6efd33cfee28296dedafbb4902360af6e9242ea59ad89dafd27e8` |
| `fork-provider-binding-0.159.patch` | `92341fd6a8fb85c35c4dc8320b4904998f3ff0dd040dc589cebb17d8431f36c0` |
| `subagent-provider-binding-0.159.patch` | `c4b9bc2dbcf8e256ff036bab06897ae3d83566a9ece15f2f5e2668c0c543bc55` |
| `parent-completion-0.159.patch` | `b138c131a34e3db554489130b6e4a5ab6e8bc815a368a941c825c79fdbfc5fa1` |

Git 对引擎只使用命令级 `-c safe.directory=E:/Projects/codex`。
本票没有 Cargo build/check/test/clean、release、补丁重新安装、另建 target/cache、clone 或 worktree，
没有修改引擎 HEAD/index、历史 `multiprovider-routing` 分支或 `work/asar-tools`。
#31 core 51、app-server 7、公开 mock 29 和 #32 TypeScript typecheck/mock 4 项结果按一致指纹复用，
没有重跑，也不计为本票新增通过项；没有改微软商店桌面端或做 Linux 验收。

## TDD、隔离与 mock 范围

已授权 seam 为公开同步 `Codex` initialize、`thread_start`、`Thread.turn().stream()`、
`thread_resume`、`thread_fork`、`Thread.run/read`、通知、供应商错误与 `CodexRpcError`。
复用两个既有真实 CLI + loopback Responses mock 测试；没有删除、放宽或 skip 关键断言。
增强版本/产物门槛和一次性成功 completion 断言，没有修改 SDK 内部或模拟 SDK 私有方法。

`verified_binary` session fixture 在启动前拒绝不一致的依赖 pin、真实安装版本、SDK runtime
依赖、CLI 路径/SHA-256 或四补丁摘要；每个 fixture 还核验 CLI 的精确 `--version`。
`CodexConfig(codex_bin=...)` 显式指定以上 CLI，不以默认 stock runtime 作为 patched 证据。

实际发布 SDK 的 `CodexConfig.env` 是对 `os.environ` 的合并。
fixture 因此用 pytest `monkeypatch` 可恢复地清除继承环境，仅保留
SystemRoot/WINDIR/PATH/PATHEXT/TEMP/TMP/COMSPEC，再设置临时 USERPROFILE/HOME/APPDATA/
LOCALAPPDATA/CODEX_HOME 与假 `ZAI_CODING_PLAN_API_KEY`；同一环境也显式传给 SDK。
每个 fixture 使用临时模型目录和 workspace、关闭 plugins；HTTP mock 仅监听 `127.0.0.1`。
真实凭据、代理与用户配置不继承，结束时关闭 mock 并由 pytest 管理临时目录。

| 单文件用例 | 公开行为与断言 |
| --- | --- |
| `test_initialize_stream_resume_and_fork` | initialize userAgent 为 0.159.2；start 路由 GLM；delta 的 thread/turn ID、文本且终结前可见；恰好一个 completed 通知；新 app-server 中按原 ID 持久 resume 并第二轮回复；fork 使用不同 ID、第三轮回复，公开 read 的原/分叉 provider 都为 `zai_coding_plan`；3 次真实 mock HTTP 请求 |
| `test_provider_and_rpc_errors` | 401 传播为 `RuntimeError`、消息不含假 key；显式 `model_provider="openai"` 跨供应商 fork 被 `CodexRpcError` 拒绝、消息包含 provider 且无假 key；仅 1 次 HTTP 请求，拒绝后没有新增请求 |

全部 4 次 HTTP 请求断言 `/api/v1/responses`、`glm-5.3-flash` 与 fixture 假 Authorization。
完整单文件执行前，父进程注入假 OPENAI/ZAI key、错误 OPENAI_BASE_URL/CODEX_HOME、
指向 `http://127.0.0.1:1` 的 HTTP_PROXY/HTTPS_PROXY/ALL_PROXY，并清空 NO_PROXY；
两项仍通过，确认隔离不受父进程污染影响。

## 实际命令与结果

```powershell
uv pip install --python work/python-sdk/Scripts/python.exe --index-url https://pypi.org/simple --cache-dir work/uv-cache -r tools/sdk/python/requirements.txt
work/python-sdk/Scripts/python.exe -m mypy --strict --cache-dir work/mypy-cache tools/sdk/python/public_api.py
$env:CODEX_TEST_ROUTED_BINARY = 'E:\Projects\codex\codex-rs\target\debug\codex.exe'
work/python-sdk/Scripts/python.exe -m pytest -q tools/sdk/python/test_routing.py::test_initialize_stream_resume_and_fork -p no:cacheprovider --basetemp work/python-sdk-test-green
# 设置上一段列出的父进程污染变量后执行：
work/python-sdk/Scripts/python.exe -m pytest -q tools/sdk/python/test_routing.py -p no:cacheprovider --basetemp work/python-sdk-test-final
```

| 阶段 | 实际结果 |
| --- | --- |
| tracer red，升级前 | 选中 1 项 setup error：拒绝旧 requirements `openai-codex==0.158.0`；没有启动模型轮次，0 skipped；0.81s |
| 公开安装 | 成功，仅替换 SDK/runtime 为 0.159.2；实际发行元数据一致 |
| strict mypy | `Success: no issues found in 1 source file` |
| tracer green | 1 passed，0 failed / skipped；2.87s |
| 完整 Python mock 单文件，含父环境污染 | 2 passed，0 failed / skipped；3.80s |
| stock runtime 拒绝反例 | binary 指向安装包 `codex_cli_bin/bin/codex.exe`，选中 1 项 setup error 于路径校验；未启动 stock CLI 或模型轮次；0.67s |

tracer red 首次使用 pytest 默认 cache，在 sandbox 下产生两条 cache 写入权限警告；
后续运行用 `-p no:cacheprovider` 和项目 `work/` 临时目录消除这一无关警告。
Git 分支/提交与 gh keyring 操作在工具允许的正常环境进行；没有输出 token 或改登录配置。
PR 自动 CI 沿用现有 Windows 轻量检查，不新增 push 触发或 dispatch 远程重型任务。

## 证据边界 / Evidence boundaries

结论仅覆盖 Windows x64、实际公开安装的 SDK/runtime 0.159.2 和准确指纹的 patched CLI，
以及上表公开同步 API 的离线 Coding Plan mock。异步 `AsyncCodex` 对等、全部 SDK API、
默认 stock runtime 路由、Python 父/子代理完成策略均未验。
普通按量服务身份不继承 Coding Plan 证据；没有真实或收费模型 API 调用，#17/#18 在线仍未验证。
0.158/#15 只作历史证据，完整 Windows 项目矩阵留 #16。

The published `openai-codex==0.159.2` distribution actually requires
`openai-codex-cli-bin==0.159.2`, and both installed metadata versions match.
Strict mypy passes for the independent public API sample. The two synchronous
Python mock tests pass against the explicitly selected shared patched CLI, including
initialize/start/turn/stream, notifications, persisted resume, fork, provider 401 and
RPC rejection. The parent-environment pollution case passes; the bundled stock CLI
is rejected before launch. No SDK/schema adapter or engine source change was needed.

All source/index/patch/lock/binary fingerprints above were checked against #31 before
reuse; heavy Rust and TypeScript evidence is reused without rerunning or counting it
as Python coverage. Async parity, default runtime behavior, Python parent/subagent
policy, real Z.AI and ordinary pay-as-you-go identity remain unverified. Real/paid
model API calls: **0**. Online #17/#18 and the full Windows project matrix #16 remain
separate. Automatic PR CI stays Windows lightweight only.
