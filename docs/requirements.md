# 需求：pi model-highlight

## 1. 背景与事故

- pi 的 footer 右侧把当前模型名显示为 **dim 灰色**，`/model`、Ctrl+P 循环、恢复会话时都容易漏看。
- 使用者因此误用了好几次比 DeepSeek 贵的模型（kimi 等）。
- 第一版实现（已废弃）按**模型名正则**分级：`/deepseek/i` 命中 = 便宜（暗绿），其余 = 红色警告 + 切换时通知。
- 直接反例：使用者刚切到一个 **free** 模型，仍被标红。名字判断从根上就是错的。

### 反例明细

| 模型 id | 官方报价（opencode-go / zen） | 名字正则判断 | 正确判断 |
| --- | --- | --- | --- |
| `longcat-2.5-preview-free` | Free | ❌ 红色 | ✅ 放心 |
| `mimo-v2.6-flash` | $0.14 / $0.28 | ❌ 红色 | ✅ 便宜 |
| `mimo-v2.6-flash-free` | Free（Zen） | ❌ 红色 | ✅ 放心 |
| `deepseek-v4.1-flash` | Go off-peak $0.15 / $0.60 | ✅ 暗绿 | ✅ 便宜 |
| `kimi-k3` | $3.00 / $15.00 | ✅ 红色 | ✅ 贵 |

## 2. 目标

在 pi 的 footer 里按**真实价格**给当前模型分级，让"我现在是不是在用贵的"一眼可见；免费/便宜的不许报警。

## 3. 硬性要求

1. **只按价格分级，禁止按模型名或厂牌判断。** 名字只用于展示。
2. **免费（$0）必须是"放心"色**，绝不能是红。
3. 价格来源必须可追溯：opencode-go / opencode zen 官方文档报价表，快照存进 `reference/`，带出处 URL 与抓取日期。
4. pi 目录里的 `ctx.model.cost` 只能当**兜底**，不能当唯一真相（已知与官网不一致、不完整，见 §4）。
5. 非 opencode-go 的 provider（`kimi-coding`、`anthropic` 等）也要有合理行为：**没有价格数据时给中性提示，不许乱判红/绿**。

## 4. 已知数据问题

pi 的 `~/.pi/agent/models-store.json`（provider `opencode-go`，2026-10-09 抓取）与官网 Go 报价表大体一致，但有偏差：

- 官网 Go 表对 DeepSeek 分 **Off-Peak / Peak 两档**（V4.1 Flash：$0.15/$0.60 ↔ $0.30/$1.20），pi 目录只存一档（存的是 off-peak）。
- **Zen 与 Go 同一模型价格不同**：DeepSeek V4 Flash 在 Zen 是 $0.14/$0.28，在 Go off-peak 是 $0.15/$0.60。必须按 provider 区分。
- pi 目录里**没有** `step-5-preview-free`，也没有 Zen 的 `*-free` 系列（`mimo-v2.6-flash-free`、`space-bunny-free`、`big-pickle`、`exo-free` …）。
- 目录里 `longcat-2.5-preview-free` 是 0/0（与官网一致），但第一版的名字判断仍然把它标红——说明问题在判断逻辑，不在数据。

结论：**自建一份按 `provider + model id` 的价格表**（从 `reference/` 生成），`ctx.model.cost` 兜底。

## 5. 订阅制的特殊性（opencode-go）

opencode-go 不是纯按量付费，而是订阅：

- **Go $10/月**、**Go Plus $40/月**。
- 每个模型有**月度额度**（$15 / $30 / $60 …）以及 5 小时 / 周 / 月的请求数上限；月度额度决定了它在 5h/周/月窗口里的用量。
- 撞到额度后，**免费模型仍可继续用**。

所以"贵"有两层含义，需求上要明确：

1. **token 单价**（$ / 1M tokens）——使用者的直觉；
2. **额度大小**——额度越小越容易撞墙（如 Kimi K3 只有 $15/月）。

建议：以单价为主分级，额度作为附加信息（可选展示）。

## 6. 分级方案（阈值待定）

| 档位 | 建议判据 | 颜色 |
| --- | --- | --- |
| Free | input = 0 且 output = 0 | 绿（放心） |
| 便宜 | input ≤ $0.30 且 output ≤ $1.20 | 暗绿 |
| 中档 | 介于两者之间 | 黄 |
| 贵 | input ≥ $1.00 或 output ≥ $4.00 | 红（+ 切换时通知） |
| 未知 | 无价格数据 | 中性（不判红） |

阈值需要使用者确认；参考数据见 `reference/opencode-go-pricing.md`。

## 7. pi 扩展 API 约束（已实测）

- **无法单独给 footer 里那个模型名换色**。只有两条路：
  - `ctx.ui.setStatus(key, text)` —— 在 footer 下加一行状态（本扩展采用）；
  - `ctx.ui.setFooter(...)` —— 整体替换 footer，需要自己重算 context 百分比、token 用量、成本。
- 相关事件：`session_start`、`model_select`（`event.source` ∈ `set` / `cycle` / `restore`）。
- `setStatus` 的文本会经过 sanitize（去掉 `\r\n\t` 并折叠空格），但 **ANSI 转义保留**，所以可以用颜色；pi-tui 的 `visibleWidth` 能正确计算含 ANSI 的宽度。
- 仅在 `ctx.hasUI` 为真时调用（JSON/print 模式无 UI）。
- 扩展放 `~/.pi/agent/extensions/`，由 dotfiles（chezmoi）管理；重开 pi 或 `/reload` 生效。

## 8. 验收标准

- 任何 Free 模型（如 `longcat-2.5-preview-free`）→ 放心色，**不是红**。
- `kimi-k3`（$3.00/$15.00）→ 红。
- `deepseek-v4.1-flash`（Go off-peak $0.15/$0.60）→ 便宜色。
- 无价格数据的模型 → 中性，不误判。
- 切换模型立即更新；启动/恢复会话时显示正确。

## 9. 开放问题

- 价格表是硬编码进扩展，还是构建时从 `reference/` 生成一个 JSON 一起提交？
- off-peak / peak 要不要区分显示（还是取更贵的一档保守判断）？
- 分级阈值最终定多少？
- 要不要顺带显示"本会话已花 / 月度额度剩余"？
- 要不要提供 `/model-highlight` 命令切换模式或临时静音？
- 是否只在 `opencode-go` 生效，其它 provider 一律走 `ctx.model.cost`？
