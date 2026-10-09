# 需求：pi-price-heat

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

## 2. 范围（Scope）

**v1 只覆盖 opencode 的模型：**

- `opencode-go` —— OpenCode Go 计划，价格取 `reference/opencode-go-pricing.md`。
- `opencode` —— OpenCode Zen，价格取 `reference/opencode-zen-pricing.md`。

两者同一模型价格不同（见 §5），必须按 provider 分开查表。

其它 provider（`kimi-coding`、`anthropic`、`openai` …）**不在 v1 范围**：用 `ctx.model.cost` 兜底，拿不到价格就中性显示，不判色、不误报。

## 3. 目标

在 pi 的 footer 里，把当前模型按**真实价格**染成一条**连续色阶**：价格越高颜色越深/越暖（越像警告），价格越低越浅/越冷（越不像警告），免费落在最浅端。

关键点：不是"高亮"，也不是"分几档打标"，而是**颜色随价格单调变化**——同一档内更贵的也不许比更便宜的颜色浅。

## 4. 硬性要求

1. **只按价格分级，禁止按模型名或厂牌判断。** 名字只用于展示。
2. **免费（$0）必须是"放心"色**，绝不能是红。
3. 价格来源必须可追溯：opencode-go / opencode zen 官方文档报价表，快照存进 `reference/`，带出处 URL 与抓取日期。
4. pi 目录里的 `ctx.model.cost` 只能当**兜底**，不能当唯一真相（已知与官网不一致、不完整，见 §5）。
5. **范围只限 opencode**：`opencode-go` / `opencode` 查本地价格表；其它 provider 用 `ctx.model.cost` 兜底，拿不到价格就中性显示，**不许乱判红/绿**。
6. **颜色随价格单调**：价格更高时，颜色不许比价格更低的更浅/更冷。

## 5. 已知数据问题

pi 的 `~/.pi/agent/models-store.json`（provider `opencode-go`，2026-10-09 抓取）与官网 Go 报价表大体一致，但有偏差：

- 官网 Go 表对 DeepSeek 分 **Off-Peak / Peak 两档**（V4.1 Flash：$0.15/$0.60 ↔ $0.30/$1.20），pi 目录只存一档（存的是 off-peak）。
- **Zen 与 Go 同一模型价格不同**：DeepSeek V4 Flash 在 Zen 是 $0.14/$0.28，在 Go off-peak 是 $0.15/$0.60。必须按 provider 区分。
- pi 目录里**没有** `step-5-preview-free`，也没有 Zen 的 `*-free` 系列（`mimo-v2.6-flash-free`、`space-bunny-free`、`big-pickle`、`exo-free` …）。
- 目录里 `longcat-2.5-preview-free` 是 0/0（与官网一致），但第一版的名字判断仍然把它标红——说明问题在判断逻辑，不在数据。

结论：**自建一份按 `provider + model id` 的价格表**（从 `reference/` 生成），`ctx.model.cost` 兜底。

## 6. 订阅制的特殊性（opencode-go）

opencode-go 不是纯按量付费，而是订阅：

- **Go $10/月**、**Go Plus $40/月**。
- 每个模型有**月度额度**（$15 / $30 / $60 …）以及 5 小时 / 周 / 月的请求数上限；月度额度决定了它在 5h/周/月窗口里的用量。
- 撞到额度后，**免费模型仍可继续用**。

所以"贵"有两层含义，需求上要明确：

1. **token 单价**（$ / 1M tokens）——使用者的直觉；
2. **额度大小**——额度越小越容易撞墙（如 Kimi K3 只有 $15/月）。

建议：以单价为主分级，额度作为附加信息（可选展示）。

## 7. 着色规则：价格 → 连续色阶

核心不是"分几档"，而是**单调映射**：

- 价格越低 → 颜色越浅/越冷；价格越高 → 颜色越深/越暖。
- 免费（$0）固定在最浅端，明确"放心"。
- 同档内也要能区分深浅：$0.10 和 $0.60 不应完全同色。

建议实现：

1. 先把价格折算成一个标量 `price`（$/1M tokens）。候选：
   - `input + output`；或
   - 以输出为主（输出通常更贵）：`input + 3 * output`；或
   - `max(input, output)`。
   待定（见 §10）。
2. 用**对数刻度**把 `price` 映到 0..1 的 severity（价格跨好几个数量级，线性会把便宜的全挤在一起）：

   ```
   severity = clamp((log10(price) - log10(lo)) / (log10(hi) - log10(lo)), 0, 1)
   ```

   建议 `lo = $0.05`、`hi = $15`。
3. severity → 颜色：浅绿（0）→ 黄（~0.5）→ 深红（1），并随 severity 提高加粗/加背景。免费直接 `severity = 0`。

锚点（用官网 Go 报价校准）：

| 模型 | Go 报价（in/out） | severity 期望 |
| --- | --- | --- |
| `longcat-2.5-preview-free` | Free | 0（最浅，放心） |
| `mimo-v2.6-flash` | $0.14 / $0.28 | 很浅 |
| `deepseek-v4.1-flash` off-peak | $0.15 / $0.60 | 浅 |
| `glm-5.3-flash` | $0.15 / $0.50 | 浅 |
| `qwen3.8-max` | $2.00 / $6.00 | 深 |
| `kimi-k3` | $3.00 / $15.00 | 最深（红） |

> 旧的"Free / 便宜 / 中档 / 贵"四档表已废弃：那是离散分档，不符合"越贵越深"的连续色阶要求。

## 8. pi 扩展 API 约束（已实测）

- **无法单独给 footer 里那个模型名换色**。只有两条路：
  - `ctx.ui.setStatus(key, text)` —— 在 footer 下加一行状态（本扩展采用）；
  - `ctx.ui.setFooter(...)` —— 整体替换 footer，需要自己重算 context 百分比、token 用量、成本。
- 相关事件：`session_start`、`model_select`（`event.source` ∈ `set` / `cycle` / `restore`）。
- `setStatus` 的文本会经过 sanitize（去掉 `\r\n\t` 并折叠空格），但 **ANSI 转义保留**，所以可以用颜色；pi-tui 的 `visibleWidth` 能正确计算含 ANSI 的宽度。
- 仅在 `ctx.hasUI` 为真时调用（JSON/print 模式无 UI）。
- 扩展放 `~/.pi/agent/extensions/`，由 dotfiles（chezmoi）管理；重开 pi 或 `/reload` 生效。

## 9. 验收标准

- 任何 Free 模型（如 `longcat-2.5-preview-free`）→ 放心色，**不是红**。
- `kimi-k3`（$3.00/$15.00）→ 红。
- `deepseek-v4.1-flash`（Go off-peak $0.15/$0.60）→ 便宜色。
- 无价格数据的模型 → 中性，不误判。
- 切换模型立即更新；启动/恢复会话时显示正确。

## 10. 开放问题

- 价格标量 `price` 怎么算（`input+output` / `input+3*output` / `max`）？
- 对数刻度的 `lo` / `hi` 取多少？
- 色阶具体走哪条路径：绿→黄→红（三段插值），还是单一红色调只变深浅（更"警告"但不显眼）？
- off-peak / peak 要不要区分显示（还是取更贵的一档保守判断）？
- 价格表是硬编码进扩展，还是构建时从 `reference/` 生成一个 JSON 一起提交？
- 要不要顺带显示"本会话已花 / 月度额度剩余"？
- 要不要提供 `/price-heat` 命令切换模式或临时静音？
- 非 opencode provider 的兜底怎么处理：也用 `ctx.model.cost` 上色阶，还是干脆不显示？
