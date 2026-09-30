# TypeScript SDK 0.159.2 Windows 离线验收 / #32

本报告对应 [#32](https://github.com/immorcoding/codex-multiprovider/issues/32)，遵循
[#6 的 Windows 单引擎执行修订](https://github.com/immorcoding/codex-multiprovider/issues/6#issuecomment-5904845915)。
**公开 `@openai/codex-sdk@0.159.2` 的 Windows x64 离线验收通过。**
项目起点为 `a13464ae07da356c49760f77235db55459b2648e`，分支 `codex/typescript-sdk-0.159.2`。

## 公开包与类型

- `tools/sdk/package.json` 精确固定 `@openai/codex-sdk` 为 `0.159.2`；npm 更新 lockfile，
  SDK 的公开依赖 `@openai/codex` 及 optional 平台记录同步为 `0.159.2`，其他依赖没有变化。
- 实际安装包 `tools/sdk/node_modules/@openai/codex-sdk/package.json` 的版本为 `0.159.2`。
  lockfile 的公开 registry integrity 为
  `sha512-rK84U6QFadh529yK9iMtwERN0rVviJ91hwvenA2RWoUi4wGnjYGZahEmoO8P/NPam+yHq8Nnkx5p3PccuF1H6w==`。
- 阅读实际发布包的 `dist/index.d.ts`，并核对冻结源码的
  [`CodexOptions`](https://github.com/openai/codex/blob/ff6aec96948b70d94983af2641a6b67c94faeff5/sdk/typescript/src/codexOptions.ts)、
  [`TurnOptions`](https://github.com/openai/codex/blob/ff6aec96948b70d94983af2641a6b67c94faeff5/sdk/typescript/src/turnOptions.ts)
  与 [`Thread`](https://github.com/openai/codex/blob/ff6aec96948b70d94983af2641a6b67c94faeff5/sdk/typescript/src/thread.ts) 的公开接口。
  `public-api.ts` 使用公开 `CodexOptions`、`ThreadOptions`、`TurnOptions`、`ThreadEvent`、`RunResult`，
  对流式与恢复后 `run` 均传递可选 `AbortSignal`，无私有接口或类型强制转换。
- 没有独立公开 SDK 缺陷证据，未修改 SDK 源码、公开包或引擎源码。

## 引擎复用指纹

先完整读取 #31 的 [机器记录](engine-validation-0.159.json) 与
[源码/行为报告](glm-responses-validation-0.159.md)，再实际核对：

| 项目 | 本票实际结果 |
| --- | --- |
| 唯一引擎 / 分支 | `E:\Projects\codex` / `codex/multiprovider-0.159.2` |
| HEAD 与 `rust-v0.159.2` | 均为 `ff6aec96948b70d94983af2641a6b67c94faeff5` |
| patch tree | `1f419cca875711ec60c723b78eae465c8fa6a47c` |
| 构建源码 tree | `8657d695298d8affdb3bb7133dd2a90694a0ae12` |
| dirty patch 源码 | 42 个实际 `git hash-object` 与 patch tree blob 一致；真实 index 与冻结 HEAD 一致 |
| Cargo.lock SHA-256 | `e85460a5c2a1f92d73ca0a40219c846f6a10d729f3186667485372c3aa82cfbf`；blob 与构建 tree 一致，该 tree 相对 patch tree 仅增加 lock 变化 |
| 真实 CLI 路径 | `E:\Projects\codex\codex-rs\target\debug\codex.exe` |
| CLI 版本 | `codex-cli 0.159.2` |
| CLI SHA-256 | `23405b52983bfb275f50500ccea8821af0e9d5889197e3978f1300f45606bb41` |

四补丁文件均实际计算 SHA-256，与 #31 一致：

| 有序补丁 | SHA-256 |
| --- | --- |
| `model-provider-routes-0.159.patch` | `d083daffc7f6efd33cfee28296dedafbb4902360af6e9242ea59ad89dafd27e8` |
| `fork-provider-binding-0.159.patch` | `92341fd6a8fb85c35c4dc8320b4904998f3ff0dd040dc589cebb17d8431f36c0` |
| `subagent-provider-binding-0.159.patch` | `c4b9bc2dbcf8e256ff036bab06897ae3d83566a9ece15f2f5e2668c0c543bc55` |
| `parent-completion-0.159.patch` | `b138c131a34e3db554489130b6e4a5ab6e8bc815a368a941c825c79fdbfc5fa1` |

本票没有 Cargo build/check/test/clean、release、另一个 target/cache、clone、worktree 或补丁重新安装。
#31 的 core 51、app-server 7、公开 mock 29 项成功结果按上述一致指纹复用，没有重跑或算作本票新增通过项。
Store 桌面端、引擎 HEAD/index 与历史分支/本地工具保持原状态。

## 测试与隔离

已约定 seam 为公开 `Codex.startThread`、`Thread.runStreamed`、`Codex.resumeThread` / `Thread.run`，
供应商 HTTP 错误与 `TurnOptions.signal`。保留既有 4 个真实 CLI + loopback Responses mock 测试，
没有放宽、删除或 skip 行为断言。

`codexPathOverride` 明确指定上表 binary。测试 hook 在轮次之前核验 manifest/lock/实际安装包版本、
binary 路径及 SHA-256、四补丁 SHA-256；每个 fixture 还实际核验 CLI `--version`。
`isolated-cli-env.mjs` 只继承 Windows 进程启动所需变量，
为 USERPROFILE/HOME/APPDATA/LOCALAPPDATA/CODEX_HOME 设置临时目录，并注入假 Coding Plan key；
不继承真实 API key、代理或 Codex 配置变量。服务只监听 `127.0.0.1`，关闭 plugins，结束后清理 fixture。

```powershell
npm install --prefix tools/sdk --save-exact @openai/codex-sdk@0.159.2 --omit=optional --ignore-scripts --no-audit --no-fund
npm run typecheck --prefix tools/sdk
$env:CODEX_TEST_ROUTED_BINARY = 'E:\Projects\codex\codex-rs\target\debug\codex.exe'
node --test --test-name-pattern='starts a GLM thread' tools/sdk/sdk-routing.test.mjs
npm test --prefix tools/sdk
$env:CODEX_TEST_UPSTREAM_CHECKOUT = 'E:\Projects\codex'
node --test --test-concurrency=1 tools/engine-baseline.test.mjs tools/binding-patches.test.mjs tools/proxy-transforms.test.mjs
./tools/check-scripts.ps1
git diff --check
```

| 命令 / 阶段 | 结果 |
| --- | --- |
| npm install | 成功；仅更新公开 SDK/CLI 版本记录，optional stock 平台包不安装、安装脚本不执行 |
| typecheck | `tsc --noEmit` 通过，实际公共类型来自 0.159.2 发布包 |
| tracer red | 版本 hook 拒绝原 `0.158.0` manifest：选中 1 项失败；无模型轮次 |
| tracer green | 同命令选中流式测试 1/1 passed，0 skipped，0.918s |
| SDK 单文件 | 4/4 passed，0 failed/cancelled/skipped，3.112s |
| stock launcher 拒绝 | 将 binary 指向 npm `@openai/codex/bin/codex.js` 后选中 1 项失败于路径校验；未启动 stock CLI |
| 票末相关轻量套件 | 18/18 passed，0 failed/cancelled/skipped，11.483s |
| 脚本语法 / whitespace | PowerShell parser、`node --check` 和 `git diff --check` 通过 |

SDK 4 项逐一验证流式消息先于 `turn.completed`、公开 thread ID、恢复后的同 ID 与第二答复、
401 错误与假 key 脱敏、AbortSignal 拒绝与无成功终结；所有真实 HTTP 请求均断言 GLM 模型、
`/api/v1/responses` 与 fixture 的假 Authorization。
单文件运行时父进程额外设置假 OPENAI/ZAI key、指向 `127.0.0.1:1` 的 HTTP/HTTPS/ALL_PROXY
与错误 CODEX_HOME，4 项仍通过，验证不会依赖父进程的真实配置或代理。

## 证据边界

结论仅覆盖 Windows x64、上述 0.159.2 SDK 与准确指纹的 patched CLI、离线 Coding Plan mock。
不沿用 #14 的 0.158 结果，不证明真实 Z.AI 或普通按量服务身份可用；真实/收费模型请求为 0，
#17/#18 在线验收仍未验证，Python SDK 留 #33，Windows 完整项目矩阵留 #16。
PR 自动 CI 沿用现有 Windows 轻量检查；未 dispatch 远程重型 workflow，也无 push/PR 双触发。
