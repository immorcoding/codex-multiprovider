# Windows 0.159.2 在线验收归档

归档日期：2026-10-02。用户暂时改用官方引擎，授权先保存未推送文档与四份脱敏报告，再清理本地魔改环境。本目录保存历史证据，不授权再次调用模型服务，也不证明新版引擎兼容。

## 报告

| 服务身份 / issue | 首次文本探针 | 其余五项 |
| --- | --- | --- |
| Coding Plan / #17 | [text-low](coding-plan-text-low.json) | [remaining](coding-plan-remaining.json) |
| 普通按量 / #18 | [text-low](payg-text-low.json) | [remaining](payg-remaining.json) |

每种身份分两次运行，共10次真实请求，HTTP状态均200；同一身份两份报告的并集覆盖text-low/text-high/text-max/tool-loop/typescript/python六项。每份原始报告保留matrixComplete=false，因为单次只选择了部分项目，不能据此要求重复消耗额度运行全部项目。

四份报告的CLI版本、sourceSha、patchTree和binarySha256完全一致：codex-cli 0.159.2；源码ff6aec96948b70d94983af2641a6b67c94faeff5；补丁tree 1f419cca875711ec60c723b78eae465c8fa6a47c；binary SHA-256 23405b52983bfb275f50500ccea8821af0e9d5889197e3978f1300f45606bb41。双SDK及Python runtime报告版本均0.159.2。

工具闭环验证streamDeltaBeforeCompletion、callIdBound、wireCallIdBound、toolResultUsed和secondTurn。TS验证流消费及持久化resume；Python验证delta先于completed及持久化resume。报告不含密钥、Authorization、原始对话、推理或实际thread/call ID；reportPath是清理前的本地历史路径，不是恢复后的有效路径。

## 授权与边界

- Coding Plan由用户手动执行两次探针，并随后确认该服务身份没有问题。
- 普通按量由控制会话执行；用户明确确认剪贴板key属于该身份、Flash Responses资格和https://api.z.ai/api/v1基址。先1次text-low成功后，再运行其余五项，预算分别1和9，失败即停。真实key仅在进程内存，不作为归档内容。
- 两个身份独立证明所列六项技术路径通过；不把一方成功替另一方背书，不承诺全部模型、全部SDK API或其他版本可用。
- 普通按量后台实际扣费金额及余额归属未由控制会话核查。请求次数上限不是金额/token上限，不把用户资格确认写成后台计费审计。
- 未升级到0.160.0或alpha版，没有新增Cargo编译；不修改商店版桌面引擎。
- 原有交付与研究文档保留其当时的“未在线验收”结论；本目录是后续在线结果，应结合时间顺序阅读。
