# X Cleaner

X Cleaner 是 x.com 的用户脚本，在帖子详情页隐藏成人引流、加密货币引流和推广账号的垃圾回复。它是对 X Reply Blocker 的净室重写，只依据功能文档（`spec/x-blocker-features.md`）和 VoidPP 的插件架构，没有参考原脚本源码。

**一切皆插件。** 内核只负责插件的注册、依赖、启停、设置和钩子；过滤判定、名单、统计、面板的每个页面、盾牌按钮、规则弹窗、AI 复核、原生拉黑都是独立插件，可以在面板「插件」标签或 Alt+Shift+X 的插件管理里单独开关。

## 安装与构建

- 安装：打开 <https://raw.githubusercontent.com/0-V-linuxdo/X-Cleaner/main/dist/X%20Cleaner.user.js>，在 Tampermonkey / Violentmonkey 里确认安装（Helium 同样适用）。
- 更新：脚本头带 `@updateURL` / `@downloadURL`，脚本管理器会从仓库 `main` 分支自动检查新版本；插件管理左下角的「检查更新」可以立即检查。每次改动都要把 `dist/` 下的构建产物一起提交。
- 语言：界面默认跟随 X 自己的语言设置（`<html lang>`），目前支持简体中文和英文；插件管理侧栏的「语言」标签页可以手动指定。
- 构建：`bun install && bun run build`，产物在 `dist/`。
- 测试：`bun test`（happy-dom 单元与集成测试），`bunx tsc --noEmit`（类型检查）。
- 浏览器冒烟：`URL=https://x.com/op/status/100 ACTIONS=$PWD/scripts/smoke-extra.mjs node scripts/smoke.mjs test/fixtures/x-status.html`。

## 目录

| 路径 | 内容 |
|---|---|
| `src/api` | 插件内核：`PluginManager`（依赖、钩子、可选钩子）、`Settings`、`Events` |
| `src/utils` | 类型、`definePlugin`、样式注册、存储、日志、`i18n`（`t()` / `N_()`） |
| `src/locales` | 界面翻译：源码里的文案是中文，`en.ts` 以中文原文为键给出英文；`test/i18n.test.ts` 检查有没有漏翻 |
| `src/config` | 屏蔽配置的默认值、规范化、导入导出、GM 存储与跨标签同步（§5） |
| `src/x` | X 页面解析：路由、ReplyContext、作用域与推荐分界线（§6、§7） |
| `src/rules` | 账号 / 词语 / 域名匹配、正则引擎与 Worker、内置分类器、本地规则合成、安全校验（§9–§11、§18、§19） |
| `src/ai` | AI 传输、预算队列、复核与规则生成的请求和严格解析（§15、§19） |
| `src/filter` | 回复控制器：扫描、按优先级调用判定器、隐藏、记录（§8、§12） |
| `src/ui` | 共用 UI：样式、主题、tooltip、toast、modal |
| `src/plugins` | 全部功能插件，见下表 |

## 插件

| 插件 | 作用 | 规格章节 |
|---|---|---|
| `_core/CoreUI`、`_core/Settings` | 基础样式与 tooltip；插件管理（「插件」标签、菜单、Alt+Shift+X） | §22、§23 |
| `_api/BlockerConfig` | 配置存储、API key、跨标签同步 | §5 |
| `_api/ReplyFilter` | 控制器、OP 保护判定器、「运行」设置页；提供 `replyJudges` 钩子 | §7、§8、§12、§21.6 |
| `_api/AiClient` | 按对话计数的 AI 预算队列 | §15.5 |
| `_api/DomObserver`、`_api/Navigation` | DOM 元素钩子、SPA 路由事件 | §24 |
| `AllowList` | 白名单判定器（20）与白名单页 | §9.1、§21.5 |
| `AccountBlacklist` | 手动（30）/ 自动（50）账号判定器与账号子页 | §9.1、§21.4 |
| `PhraseBlacklist` | 词语判定器（60）与词语子页 | §9.2、§21.4 |
| `DomainBlacklist` | 域名判定器（70）与域名子页 | §9.3、§21.4 |
| `RegexBlacklist` | 安全同步（80）/ Worker（100）正则判定器、超时自动停用、正则子页 | §10、§21.4 |
| `BuiltinClassifier` | 内置分类器（90）与「类别」设置页 | §11、§21.6 |
| `AutoBlacklist` | 订阅「已隐藏」事件自动入册、对话内抑制、越界回滚 | §13 |
| `RuleStats` | 规则命中统计（单独存储、跨标签同步） | §14 |
| `TombstoneFilter` | 官方「此帖子不可用」占位条 | §6.7、§12.6 |
| `AiReview` | AI 复核、复查页「AI 复核」按钮、「AI」设置页 | §15、§21.6 |
| `Panel` | 悬浮按钮、抽屉、复查页、导入页；提供 `panelTabs`、`panelPages`、`reviewActions` 钩子 | §21 |
| `ReplyShield` | 回复旁的盾牌按钮 | §16 |
| `RuleDraft` | 规则草稿弹窗（划词、本地模板、AI 生成、追问、安全校验、保存） | §17–§19 |
| `NativeBlock` | 复查页「在 X 中拉黑」，只打开 X 原生确认框 | §20 |
| `SidebarEntries` | X 左侧栏入口管理：每个入口可显示 / 隐藏、可排序（拖动或箭头），纯 CSS 实现，不改 X 的 DOM | — |
| `_core/UserStyles` | 应用「主题」（https 链接或本地 .css）与「快速 CSS」；插件管理器对应两个标签页 | — |
| `_api/PostMenuAPI` | 帖子和主页「…」菜单钩子 `postMenuItems` / `profileMenuItems`：克隆 X 原生行插入自定义项（黑名单、白名单、生成规则、AI 复核、导出已接入） | — |
| `ExportThread` | 帖子页「…」菜单导出主帖和已加载的回复（Markdown / JSON），标出被隐藏的回复和原因 | — |
| `MoreMenuEntry` | X 左侧「更多」菜单里的「X Cleaner 插件管理」入口，及星标插件的快捷开关 | — |
| `SelectorHealth` | 选择器健康检查：页面结构变化导致插件找不到元素时，在插件卡片和顶部通知条提示 | — |
| `Declutter` | 隐藏 Premium 推销、推广帖、Grok 按钮、浏览量等（逐项开关） | — |
| `RightSidebarCleaner` | 隐藏右侧栏三大件：「有什么新鲜事」趋势、「推荐关注」、页脚链接（逐项开关，默认全部隐藏） | — |
| `HidePostEntries` | 隐藏发帖入口：主页时间线顶部的发帖框、左侧栏的「发帖」按钮（逐项开关，默认全部隐藏） | — |
| `StreamerMode` | 直播 / 截图模式：模糊自己的头像、名字和私信列表名字，可悬停显示；可把账号菜单里的名字换成别名 | — |
| `WiderTimeline` | 加宽时间线（600–1200px），可隐藏右侧栏 | — |
| `AbsoluteTimestamps` | 把「3 小时」之类相对时间换成绝对时间（智能 / 完整 / 精确到秒） | — |
| `BetterLinks` | 悬停时把 t.co 换成真实链接、显示完整 URL、自定义链接颜色 | — |

新功能的写法：在 `src/plugins/<名字>/index.ts` 里 `definePlugin({...})`，按需声明 `replyJudges`（判定器）、`panelPages`（面板页面）、`reviewActions`（复查操作）、`events`（订阅 `replyHidden` 等事件）。构建时自动发现，不需要改内核。
