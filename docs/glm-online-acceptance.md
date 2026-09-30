# 可复用 GLM 验收工具（Windows 0.159.2）

对应 #17 Coding Plan / #18 普通按量服务身份。两者独立报告，不能用一方成功替另一方背书。
用户确认的测试 seam：命令行/退出码、报告脱敏、真实补丁 CLI 的 loopback Responses、公开双 SDK 流式/恢复。
这里只交付工具；不授权自动真实请求，不关闭在线票，不修改 Store 或原引擎源码。

## 一键入口

在 PowerShell 中进入 E:\Projects\codex-multiprovider：

```powershell
# 默认全部项目，只有本地 mock，不要 API key，也不收费
.\tools\test-glm.ps1 -Service coding-plan
.\tools\test-glm.ps1 -Service payg

# 先运行一个快速文本项目
.\tools\test-glm.ps1 -Service coding-plan -Cases text-low -MaxRequests 1
```

复用唯一 E:\Projects\codex/codex-rs/target/debug/codex.exe、现有 TS tools/sdk/node_modules
与 Python work/python-sdk/Scripts/python.exe。每次先核验 #31 冻结源码/index/patch/lock/binary，
不会重新编译。不能用 stock SDK runtime 或旧 binary 通过验收。

## 明确开启真实模式

先核对服务资格和预算；这些命令 **会消耗真实额度/余额**。本次实现没有执行它们：

```powershell
# #17：本票适用的 Coding Plan key
.\tools\test-glm.ps1 -Service coding-plan -Live -ConfirmLive -Cases text-low -MaxRequests 1

# #18：先由官方确认普通按量账户/key + Flash 的 Responses 资格和基址
.\tools\test-glm.ps1 -Service payg -Live -ConfirmLive -ResponsesQualified -BaseUrl https://api.z.ai/api/v1 -Cases text-low -MaxRequests 1
```

若相应进程环境变量没有 key，PowerShell 会隐藏输入，运行完删除临时环境变量。
已有变量则直接用，不修改它：Coding Plan = ZAI_CODING_PLAN_API_KEY，普通按量 = ZAI_PAYG_API_KEY。
不要在命令参数、config 或 issue 填 key，不要开 PowerShell transcript/HTTP trace。

-Live、-ConfirmLive、明确的 -MaxRequests 是必需门槛。payg 另需 -ResponsesQualified 和 -BaseUrl；
资格标志是使用者的明确声明，**不是自动验证账户已获资格**。基址未确认就不要探测。
本轮只允许官方已记录的国际 Z.AI HTTPS Responses 主机/基址；拒绝 query/userinfo/fragment、
错误 Chat 基址和其他 host，服务端 redirect 不跟随，不盲目拼 /paas/v4/responses。
未来经确认新增主机/路径需修改 profiles 的白名单及测试，不要删除保护。

live 不指定 -Cases 时默认只跑 text-low，mock 默认全部。low 失败即停止；成功且用量符合预期后，
可单独跑 text-high,text-max，再跑 tool-loop、typescript、python。全部可用 -Cases all -MaxRequests 10，
但必须主动选择，**不保证每个模型都严格只发10次**，超过请求预算会失败。

## 分项、限制与失败演练

| case | 覆盖 | 当前成功 mock 的 Responses 请求数 |
| --- | --- | --- |
| text-low / text-high / text-max | CLI exec、对应 effort、唯一完成事件、合成 ACK | 各1 |
| tool-loop | initialize、动态 function call/callId、工具结果续轮、同线程第二轮 | 3 |
| typescript | SDK runStreamed、resumeThread 和合成上下文 | 2 |
| python | SDK delta 先于 completed、新进程持久 resume | 2 |

```powershell
.\tools\test-glm.ps1 -Service coding-plan -Cases text-low,text-high,text-max -MaxRequests 3
.\tools\test-glm.ps1 -Service payg -Cases tool-loop -MaxRequests 3
.\tools\test-glm.ps1 -Service coding-plan -Cases typescript,python -MaxRequests 4 -TimeoutMs 120000

# 仅 mock 的失败演练；退出码1是预期，不要将其填为在线结果
.\tools\test-glm.ps1 -Cases text-low -MockScenario secret-error
.\tools\test-glm.ps1 -Cases text-low -MockScenario missing-completed
.\tools\test-glm.ps1 -Cases text-low -MockScenario slow -TimeoutMs 2000
```

-MaxRequests 的范围是1–50：计数在中继发往服务端前消耗，每个失败/续请求也占预算，
并发请求不能绕过上限；无客户端自动重试。它是**发起尝试次数上限，不是金额/token上限**。
服务端是否已经计算/扣费无法用本地超时保证取消，必须配合服务后台预算/用量核查。
-TimeoutMs 范围1–300000，默认120000；两轮协议/SDK项目最多约两倍此期限，产物核验有独立期限。
首个失败后不运行后续项目。Ctrl+C 停止当前验收；已发出的服务端请求可能仍被计费。

可选 -EnginePath（仍须精确指纹匹配同一引擎）、-PythonPath（现有159.2 SDK环境）。
不克隆、不新建worktree/target、不运行Cargo，不使用真实项目目录。

## 报告与隐私

stdout 为一份 JSON；报告保存在 work/glm-acceptance-<profile>-*/report.json（Git忽略）。
退出码：0 = 选定项目通过；1 = 执行失败；2 = 参数/授权/资格/凭据/端点门槛拒绝。
报告含 schemaVersion、服务身份/profile/issue、选定case、各项状态、HTTP状态/effort、
发起请求数、remoteRequests、起止时间、逐项耗时、未执行case、产物指纹及报告路径。
工具case另外比较服务端SSE function_call的call_id与HTTP续请求的function_call_output.call_id，
与app-server通知的callId证据分开记录（wireCallIdBound）。同线程通知必须属于当前turn/start返回的turn ID。

mode=mock 永远 liveCompatibility=unverified，remoteRequests=0。
一个 case 的 status=passed 不能说明整票在线通过；matrixComplete 区分是否选择并通过所有项目。
即使完整 live 通过，也只针对这一个 profile，仍要人工核查费用归属、失败边界后再关对应票。

真实 key 仅在协调进程内存，由其添加 Authorization；CLI/SDK 子进程只拿随机验收 HOME
与本地中继凭据，不能从其 env/config 得到真实 key。中继成功流过滤已知 key，HTTP错误正文不转存。
不打印上游正文、推理、完整对话、线程ID/callId或key。报告可以人工检查后上传对应 issue，
但不要整包上传 HOME：那里有引擎自行持久化的**合成**会话/数据库，不属于公开报告。

只响应一次 acceptance_echo 动态工具，返回合成随机值；该工具不执行 shell。
禁用验收工作目录上级AGENTS文档加载，避免真实仓库指令混入合成请求。
read-only/never 不是“所有内置工具绝对不能运行”的保证；保持空 workspace，不挂载业务文件。
不测图像、全部SDK API、Python AsyncCodex、父/子代理策略、Store、其他模型或其他身份。

## 直接用 Node、修改与回归

```powershell
node tools/glm-acceptance/run.mjs --profile coding-plan --cases text-low --max-requests 1
# 示例live：需先在本进程安全设置对应key；Node不会交互输入
node tools/glm-acceptance/run.mjs --profile payg --live --confirm-live --responses-qualified --base-url https://api.z.ai/api/v1 --cases text-low --max-requests 1

# 本地回归仅外部HTTP是mock，其余是真实CLI与公开SDK
node --test tools/glm-acceptance.test.mjs
npm run typecheck --prefix tools/sdk
work/python-sdk/Scripts/python.exe -m mypy --strict --cache-dir work/mypy-cache tools/glm-acceptance/python-probe.py
```

- 服务身份/环境变量/官方基址及白名单集中在 config/glm-acceptance-profiles.json。
- 参数与case选择在 tools/glm-acceptance/options.mjs，编排/报告在 run.mjs。
- 隔离进程/有界中继在 session.mjs；唯一 mock边界在 mock-provider.mjs。
- 协议、TS、Python适配器分别是 rpc-probe.mjs、typescript-probe.mjs、python-probe.py。
- 增加项目先在公开 CLI/退出码/报告 seam 写失败测试，然后接入适配器/外部HTTP fixture。
- rpc-fixture.cjs仅用于适配器错turn负例的外部JSON-RPC传输注入，不能代替真实CLI验收。
- 改引擎/版本/model契约时先更新真实冻结证据与SDK pins，不加跳过指纹的捷径。

完整冻结交付见 [Windows交付](windows-delivery-0.159.md)。

