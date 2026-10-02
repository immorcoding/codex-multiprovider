# Issue tracker：GitHub

本仓库的需求、规格和任务记录在 GitHub Issues。使用 `gh` CLI 操作；在仓库内运行时，由 Git remote 确定仓库。

## 常用操作

- 创建：`gh issue create --title "..." --body "..."`
- 阅读：`gh issue view <number> --comments`，同时查看标签。
- 列出：`gh issue list --state open --json number,title,body,labels,comments`，按任务需要筛选状态和标签。
- 评论：`gh issue comment <number> --body "..."`
- 增删标签：`gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- 关闭：`gh issue close <number> --comment "..."`

当 skill 要求“发布到 issue tracker”时，创建 GitHub issue；要求“获取相关 ticket”时，读取对应 issue 及评论。

## Pull requests 作为分流入口

**PRs as a request surface: no.** 如以后希望把外部 PR 当作需求分流，可将此值改为 `yes`。

## Wayfinder 约定

- 地图是一个带 `wayfinder:map` 标签的 issue，正文记录 Notes、Decisions-so-far 和 Fog。
- 子任务优先使用 GitHub sub-issues；若不可用，在地图的任务列表中链接，并在子任务正文开头写 `Part of #<map>`。任务类型标签为 `wayfinder:<type>`。
- 阻塞关系优先使用 GitHub 原生 issue dependencies；若不可用，在正文开头写 `Blocked by: #<n>`。
- 从地图顺序中选取未分配、且没有未关闭阻塞项的首个开放子任务；领取时分配给当前开发者。
- 解决后在子任务评论中记录结论、关闭子任务，并将结论及链接写入地图的 Decisions-so-far。
