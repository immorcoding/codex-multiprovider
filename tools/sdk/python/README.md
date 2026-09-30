# Published Python SDK / patched app-server 0.159.2

Install the exact public PyPI releases into the existing E-drive environment:

```powershell
uv pip install --python work/python-sdk/Scripts/python.exe --index-url https://pypi.org/simple --cache-dir work/uv-cache -r tools/sdk/python/requirements.txt
$env:CODEX_TEST_ROUTED_BINARY = 'E:\Projects\codex\codex-rs\target\debug\codex.exe'
work/python-sdk/Scripts/python.exe -m mypy --strict --cache-dir work/mypy-cache tools/sdk/python/public_api.py
work/python-sdk/Scripts/python.exe -m pytest -q -p no:cacheprovider tools/sdk/python/test_routing.py
```

The environment must already exist; these commands reuse it without deleting it.
Use the single verified Windows x64 engine at `ff6aec96948b70d94983af2641a6b67c94faeff5`
with the four ordered 0.159 patches in [engine-baseline.md](../../../docs/engine-baseline.md).
Before reusing it, compare actual HEAD/index/source/lock/binary fingerprints with
[the #31 handoff](../../../docs/engine-validation-0.159.json).
This ticket does not compile the engine. PR CI remains Windows lightweight only;
the Python behavior results come from the local patched CLI.

The binary variable is mandatory. The session fixture checks release pins, installed
SDK/runtime metadata, the SDK's exact runtime dependency, binary path/SHA-256 and four
patch hashes before launching a model turn. Each fixture also checks CLI `--version`.
An upstream bundled runtime fails the binary-path check before launch.
`CodexConfig(codex_bin=...)` explicitly launches the shared patched app-server over stdio.

## Runtime pairing (verified 2026-09-30)

The **published** `openai-codex==0.159.2` wheel declares
`openai-codex-cli-bin==0.159.2`; both installed distribution versions are 0.159.2.
The frozen tag's source `sdk/python/pyproject.toml` instead contains the placeholder
`0.0.0-dev` and runtime `0.153.4`. Use installed release metadata for the pairing.
The bundled runtime is the upstream CLI and does **not** contain this repository's patches.

No SDK source changes or schema adapters were needed. `metadata.userAgent`,
`TurnStatus.completed`, `Thread.run`'s `RuntimeError` for failed provider turns and
`CodexRpcError` for rejected cross-provider forks match the released public API.
The independent `public_api.py` sample passes strict mypy against the installed 0.159.2
public imports/signatures. It is a typecheck sample, not an isolated runtime runner.

## Isolation and coverage

`CodexConfig.env` **augments** inherited `os.environ`. The fixture therefore uses
pytest's reversible environment override to allow only Windows process-startup variables,
then supplies disposable USERPROFILE/HOME/APPDATA/LOCALAPPDATA/CODEX_HOME and a fake key.
It passes the same environment to the SDK. No real keys, proxy or Codex config variables
reach the child. Plugin sync is disabled; the server binds only to `127.0.0.1`.

The two existing synchronous mock tests pass with the 0.159.2 patched engine:

- Initialize metadata, thread start/turn/stream, typed delta IDs before held completion,
  exactly one successful completion notification, persisted resume in a fresh app-server,
  fork with inherited provider, and public `read` confirmation.
- Provider 401 propagation, fake-key redaction and RPC rejection of an explicit
  cross-provider fork before any extra HTTP request.

Every HTTP request must use `/api/v1/responses`, `glm-5.3-flash` and the fixture's fake
Authorization. Parent fake keys, unusable loopback proxies and an incorrect CODEX_HOME
do not affect the passing tests. No assertion was removed, relaxed or skipped.
See [actual commands, counts and full fingerprints](../../../docs/python-sdk-validation-0.159.md).

This covers the synchronous public SDK boundary on Windows x64. Async parity,
default-runtime routing and parent/subagent completion policy through Python are not
tested here. The shared #31 Rust/behavior results and #32 TypeScript results are reused
only because the engine fingerprints match, and are not counted as new Python passes.
The 0.158/#15 report is historical. No real/paid model API calls were made; ordinary
pay-as-you-go service identity and online #17/#18 remain unverified. Full Windows
project acceptance remains with #16.

## 中文说明

本票安装公开 `openai-codex==0.159.2` / `openai-codex-cli-bin==0.159.2`，沿用已有 E 盘
Python 环境和 #31 的唯一补丁 CLI，不编译或修改引擎。实际安装元数据确认 SDK 精确依赖同版
runtime；tag 中的 `0.0.0-dev` / `0.153.4` 是源码记录，不能替代发布版本。
随包 runtime 不含补丁，测试会在启动前拒绝其路径。

`CodexConfig.env` 合并父进程环境，fixture 因此先用 pytest 可恢复的环境覆盖隔离继承变量，
仅保留 Windows 启动变量，再设置临时用户目录、CODEX_HOME 与假 key，并把同一环境传给 SDK。
只访问 `127.0.0.1` mock，关闭 plugins，不继承真实凭据、代理或配置。
两个同步用例覆盖 initialize/start/turn/stream、通知、冷恢复、分叉、供应商 401 与 RPC 错误，
父进程污染环境反例仍通过；strict mypy 无问题，未修改 SDK 源码或添加 schema 适配。
异步对等、Python 父/子代理策略、默认 stock runtime 路由与在线服务未验；
普通按量身份不继承 Coding Plan 离线证据，#17/#18 未验，完整 Windows 项目矩阵留 #16。
