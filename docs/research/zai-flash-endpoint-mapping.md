# Z.AI GLM-5.3-Flash 端点与 Responses 支持核查

核查日期：2026-09-28。范围仅为 Z.AI 官方公开文档与公开 OpenAPI 规范；未使用密钥、未发起模型服务请求。本文提供 #5 决策的证据，不代替用户决定供应商映射或验收门槛。

## 官方明示

- Z.AI 的模型页将 `glm-5.3-flash` 列为 Model API 的模型代码，API Documentation 指向 **Chat Completion API**；同页也明确该模型已加入 GLM Coding Plan（而 `glm-5.3-flashx` 尚未加入）。因此 Flash 同时有普通 Model API 与 Coding Plan 产品入口，但该页没有声称两个入口均可使用 Responses。[GLM-5.3-Flash/FlashX 模型页](https://docs.z.ai/guides/vlm/glm-5.3-flash)
- Coding Plan 的协议/基址表明确列出：OpenAI Responses 为 `https://api.z.ai/api/v1`，OpenAI Chat Completions 为 `https://api.z.ai/api/coding/paas/v4`，Anthropic Messages 为 `https://api.z.ai/api/anthropic`。Z.AI 的 Codex 指南明确要求 `wire_api = "responses"`，且给出 `base_url = "https://api.z.ai/api/v1"`。配置的是**基址**，不是自行追加的最终请求路径。[Coding Plan 快速开始](https://docs.z.ai/devpack/quick-start)、[Codex 指南](https://docs.z.ai/devpack/tool/codex)
- 普通 Z.AI Platform API 的引言给出通用基址 `https://api.z.ai/api/paas/v4`，并特别要求 Coding Plan 使用其专用端点。其 OpenAI SDK 与 HTTP 示例都是 Chat Completions；**不能**把 `paas/v4` 当作 Responses 基址。[API Reference 引言](https://docs.z.ai/api-reference/introduction)、[OpenAI Python SDK 指南](https://docs.z.ai/guides/develop/openai/python)。但 [GLM-5.3 模型页](https://docs.z.ai/guides/llm/glm-5.3)在 Model API 栏另列 `https://api.z.ai/api/v1` 为 Responses 基址，适用资格的限制见下方复核。
- Z.AI 给 `GLM-5.3-Flash` 列出按 token 计价；这支持普通 API 产品中有此模型，但不能证明普通 API 的 Responses 协议支持。[定价页](https://docs.z.ai/guides/overview/pricing)、[模型页](https://docs.z.ai/guides/vlm/glm-5.3-flash)
- Coding Plan 凭据与普通 API 凭据/配额并非可无条件互换：官方 Codex 指南说 Team Plan Key 不可与其他 Z.AI API Keys 互换，Coding Plan 集成指南说明错误端点不能使用订阅额度，且 Coding Plan 限于官方支持的工具或产品环境。[Codex 指南](https://docs.z.ai/devpack/tool/codex)、[Tool Integration](https://docs.z.ai/devpack/tool/others)

## 可推断但尚未证实

- Coding Plan 支持 Responses 协议，且 Flash 属于该 Plan 的可用模型。两条官方陈述合起来使 `glm-5.3-flash` 配 `https://api.z.ai/api/v1` 成为**有根据的候选配置**；Codex 指南的现成 `models.json` 示例却只列 `glm-5.3`，没有直接展示 Flash 通过 Responses 的请求/工具续轮。仍需经授权在线验收，不能由文档推断为完整 Codex 兼容。[Coding Plan 快速开始](https://docs.z.ai/devpack/quick-start)、[模型页](https://docs.z.ai/guides/vlm/glm-5.3-flash)、[Codex 指南](https://docs.z.ai/devpack/tool/codex)
- 用户可配置基址有价值，但“只是 URL 不同”过强：当前官方资料区分了 **产品/计费资格、凭据与协议**。GLM-5.3 的 Model API 表与 Coding Plan 表都列 `api/v1` 为 Responses 基址；普通 API 引言所示 `paas/v4` 只示范 Chat Completions。底层客户端固定 `wire_api = "responses"` 时，不能单把基址改为 `paas/v4`。[GLM-5.3 模型页](https://docs.z.ai/guides/llm/glm-5.3)、[API Reference 引言](https://docs.z.ai/api-reference/introduction)、[Coding Plan 快速开始](https://docs.z.ai/devpack/quick-start)

## 未知与需要验证的点

- GLM-5.3 的 Model API 表列出了 Responses 基址 `https://api.z.ai/api/v1`，但未找到 `glm-5.3-flash` **使用普通按量凭据**的 Responses 请求示例或资格保证。因此不能指定 `https://api.z.ai/api/paas/v4` 为可用 Responses 基址。官方公开 [OpenAPI 规范](https://docs.z.ai/openapi.json) 的 `paths` 逐项检查只列出 `/paas/v4/chat/completions` 等普通 API 路径，没有任何名为 Responses 的路径；这是“公开规范未记载”，**不是服务端必定不支持**的证明。
- Z.AI 的 OpenAI SDK 指南称接口整体兼容，但也提示在某些场景存在差异；其示例均为 Chat Completions，不能据此推定 Responses 的请求字段、SSE 事件、函数调用与 `call_id` 续轮完全兼容。[OpenAI Python SDK 指南](https://docs.z.ai/guides/develop/openai/python)
- 普通按量凭据是否有资格通过已列出的 `api/v1` Responses 基址调用 Flash，应由 Z.AI 官方明确资料或经用户授权、使用对应凭据的在线探测确认。验收结果须区分 Coding Plan 与普通 API 两种产品，不能以一方通过替另一方背书。

## 对 #5 的简短结论

可以把 **Z.AI / `glm-5.3-flash` / Coding Plan Responses / `https://api.z.ai/api/v1`** 列为有官方依据、待实际兼容验收的候选。GLM-5.3 的 Model API 栏也列同一 Responses 基址；但普通按量凭据调用 **Flash** 的资格与支持状态未知。`https://api.z.ai/api/paas/v4` 是普通 API 的 Chat Completions 基址，不能将两种产品表述为“Responses 仅 URL 不同”。

## 复核（2026-09-28）：端点按协议、产品与模型分别看

| 官方文档明确的用途 | Base URL（不是完整 POST URL） | 证据边界 |
| --- | --- | --- |
| Coding Plan / OpenAI Responses | `https://api.z.ai/api/v1` | [Coding Plan 快速开始](https://docs.z.ai/devpack/quick-start)及[Codex 指南](https://docs.z.ai/devpack/tool/codex)明确列出；Codex 示例设置 `wire_api = "responses"`，但模型目录示例只有 `glm-5.3`。 |
| Coding Plan / OpenAI Chat Completions | `https://api.z.ai/api/coding/paas/v4` | [Coding Plan 快速开始](https://docs.z.ai/devpack/quick-start)明确列出；勿与 Responses 的基址混淆。 |
| 通用 Platform API / Chat Completions | `https://api.z.ai/api/paas/v4` | [API Reference 引言](https://docs.z.ai/api-reference/introduction)明确通用基址，完整 HTTP 示例是 `POST https://api.z.ai/api/paas/v4/chat/completions`；并未把此基址标为 Responses。 |

新增的关键证据是 [GLM-5.3 模型页](https://docs.z.ai/guides/llm/glm-5.3)在 **Model API** 小节也列出 OpenAI Response Protocol 的基址 `https://api.z.ai/api/v1`，并列出 Chat Completion 的 `https://api.z.ai/api/coding/paas/v4`。但该页紧接着注明：曾订阅 Coding Plan（包括已过期）的用户当前通过 Model API 只能访问 Chat Completion 兼容协议。故「`api/v1` 仅属于 Coding Plan」说得过满；相反，「所有普通按量凭据和 `glm-5.3-flash` 都可在该基址用 Responses」也没有被这张针对 `glm-5.3` 的表格直接证实。[Flash/FlashX 模型页](https://docs.z.ai/guides/vlm/glm-5.3-flash)在 Model API 下给 `glm-5.3-flash` 模型代码，却只链接 Chat Completion API；它确认 Flash 可用于 Coding Plan。此前的未知项应更精确表述为：**普通按量凭据调用 Flash 的 Responses 资格、路径及端到端兼容性未获 Flash 专属官方示例或授权实测确认**；不是说 Z.AI 官方完全未提通用 Model API 的 Responses。官方 [文档索引](https://docs.z.ai/llms.txt)和[公开 OpenAPI](https://docs.z.ai/openapi.json)也未列独立的 Responses API 参考条目；不能凭通用 Chat 基址拼接 `/responses`，也不能把「未列出」等同于服务不存在。

思考强度应采用官方[核心参数表](https://docs.z.ai/guides/overview/concept-param)：`glm-5.3` 与 `glm-5.3-flash` **仅** `low`（轻量）、`high`（增强）、`max`（深度），默认 `max`；两者 `thinking.type` 强制 `enabled`，不能关闭。[GLM-5.3 页](https://docs.z.ai/guides/llm/glm-5.3)亦列相同取值与默认，[Flash 页](https://docs.z.ai/guides/vlm/glm-5.3-flash)推荐 `reasoning_effort: max`，并说明文本参数与 GLM-5.3 一致。`none`、`minimal`、`medium`、`xhigh` 不应照搬 GLM-5.2 的兼容映射。以上是模型参数文档，具体在 Responses wire 上的字段接受程度仍需在线验收。
