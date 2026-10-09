# 需求：pi-price-heat

## 1. 目标

pi 的 footer 右侧把当前模型名显示为 **dim 灰色**，`/model`、Ctrl+P 循环、恢复会话时都容易漏看，进而误用偏贵的模型。

本扩展在 footer 加一行状态，把当前模型按**真实价格**染成一条**连续色阶**：

- 价格越高颜色越深/越暖（越像警告），越低越浅/越冷（越不像警告），免费落在最浅端。
- 不是"高亮某个模型"，也不是"分几档打标"，而是**颜色随价格单调变化**：同一档内更贵的也不许比更便宜的颜色浅。
- **只看价格，绝不按模型名或厂牌判断**；名字只用于展示。

## 2. 范围

**v1 只覆盖 opencode 的模型：**

- `opencode-go` —— OpenCode Go 计划。
- `opencode` —— OpenCode Zen。

两者价格都来自 models.dev（`https://models.dev/api.json`）；同一模型在两个 provider 价格不同（见 §4），必须按 provider 分开查表。

其它 provider（`kimi-coding`、`anthropic`、`openai` …）**不在 v1 范围**：用 `ctx.model.cost` 兜底，拿不到价格就中性显示，不判色、不误报。

## 3. 硬性要求

1. **只按价格分级，禁止按模型名或厂牌判断。** 名字只用于展示。
2. **免费（$0）必须是"放心"色**，绝不能是红。
3. 价格来源必须可追溯：**models.dev** 的 provider 数据（`https://models.dev/api.json`），扩展运行时动态获取并落盘缓存；出处与机制见 §4、§6.5。
4. pi 目录里的 `ctx.model.cost` 只能当**兜底**，不能当唯一真相（已知与真实报价有偏差，见 §4）。
5. **范围只限 opencode**：`opencode-go` / `opencode` 查 models.dev 价格表；其它 provider 用 `ctx.model.cost` 兜底，拿不到价格就中性显示，**不许乱判红/绿**。
6. **颜色随价格单调**：价格更高时，颜色不许比价格更低的更浅/更冷。

## 4. 价格来源（models.dev）

价格取自 models.dev 的聚合 JSON：`https://models.dev/api.json`，只切出 provider `opencode-go` / `opencode`。

- 一个 `provider + model id` 只给**一档** `cost.input` / `cost.output`（$ / 1M tokens），没有 Off-Peak/Peak 分档。
- **Go 与 Zen 同一模型可能不同价**：DeepSeek V4.1 Flash 在 Go 是 off-peak `$0.15/$0.60`，在 Zen 是 peak `$0.30/$1.20`。必须按 provider 分开查表，不能合并。
- models.dev 里的 `*-free` 模型 cost 为 `0/0`，与其它模型一视同仁地按价格计算即可。

结论：**以 models.dev 为唯一真相**（按 `provider + model id` 查表），`ctx.model.cost` 仅作非 opencode provider 的兜底。

## 5. 订阅制的特殊性（opencode-go）

opencode-go 不是纯按量付费，而是订阅：

- **Go $10/月**、**Go Plus $40/月**。
- 每个模型有**月度额度**（$15 / $30 / $60 …）以及 5 小时 / 周 / 月的请求数上限；月度额度决定了它在 5h/周/月窗口里的用量。
- 撞到额度后，**免费模型仍可继续用**。

所以"贵"有两层含义：

1. **token 单价**（$ / 1M tokens）——使用者的直觉；
2. **额度大小**——额度越小越容易撞墙（如 Kimi K3 只有 $15/月）。

v1 以**单价**分级；额度作为附加信息，待定（见 §9）。

## 6. 着色规则：价格 → 连续色阶

### 6.1 价格标量

```
price = input + output        # $/1M tokens
```

- 用 `input + output`（blended）不额外加权：简单、可直接对着 models.dev 报价核对。
- models.dev 每个模型只给一档价（无 Off-Peak/Peak 之分）。
- 免费（`input == 0 && output == 0`）直接 `severity = 0`。
- `cacheRead` 不参与：它只在有缓存时适用，纳入会让判断依赖运行状态而不是模型本身。

### 6.2 对数映射

```
severity = clamp((log10(price) - log10(lo)) / (log10(hi) - log10(lo)), 0, 1)
lo = 0.30     # opencode 里最便宜的付费模型（Muse Spark Contributor 0.10/0.20）
hi = 20.00    # “明显贵”的锚点，≈ Kimi K3（3+15=18）
```

用对数是因为价格跨两个数量级，线性会把便宜模型全挤在一起。超过 `hi` 的（如 Zen 的 GPT-5.4 Pro = 210）一律 clamp 到 1。

### 6.3 颜色

三段 RGB 插值：

| severity | 颜色 | 属性 |
| --- | --- | --- |
| 0（含免费） | `#8ce99a` 浅绿 | dim |
| 0 – 0.5 | 浅绿 → `#ffd43b` 黄 | 常规 |
| 0.5 – 1.0 | 黄 → `#ff5555` 红 | 常规 |
| ≥ 0.7 | — | bold |
| ≥ 0.9 | — | bold + 反白（白字 + 该色背景） |
| 无价格 | 灰白 | dim（不入色阶） |

插值在 RGB 空间线性进行，亮度/饱和度随 severity 单调变化，保证“越贵越深”。

### 6.4 锚点（按 §6.1–6.2 算出的期望值）

| 模型 | provider | in/out | price | severity |
| --- | --- | --- | --- | --- |
| `longcat-2.5-preview-free` | opencode-go | Free | 0 | 0.00（dim 绿） |
| `muse-spark-1.3-contributor` | opencode-go | 0.10 / 0.20 | 0.30 | 0.00 |
| `mimo-v2.6-flash` | opencode-go | 0.14 / 0.28 | 0.42 | 0.08 |
| `glm-5.3-flash` | opencode-go | 0.15 / 0.50 | 0.65 | 0.18 |
| `deepseek-v4.1-flash`（Go off-peak） | opencode-go | 0.15 / 0.60 | 0.75 | 0.22 |
| `deepseek-v4.1-flash`（Zen peak） | opencode | 0.30 / 1.20 | 1.50 | 0.38 |
| `minimax-m3` | opencode-go | 0.30 / 1.20 | 1.50 | 0.38 |
| `kimi-k2.7-code` | opencode-go | 0.95 / 4.00 | 4.95 | 0.67 |
| `glm-5.3` | opencode-go | 1.40 / 4.40 | 5.80 | 0.71（起 bold） |
| `qwen3.8-max` | opencode-go | 2.00 / 6.00 | 8.00 | 0.78 |
| `kimi-k3` | opencode-go | 3.00 / 15.00 | 18.00 | 0.97（反白） |
| `gpt-5.4-pro` | opencode | 30 / 180 | 210 | 1.00（clamp） |

### 6.5 取价与缓存（动态）

扩展在 `session_start` 时**动态获取** `https://models.dev/api.json`，切出两个 provider，得到 `provider → model id → {input, output, cacheRead, name}`。

- 落盘缓存：`$XDG_CACHE_HOME/pi-price-heat/models-dev.json`（macOS 无 XDG 时为 `~/Library/Caches/pi-price-heat/models-dev.json`），带 `fetchedAt` 与 `etag`。
- 缓存 12h 内直接用；过期后用 `If-None-Match` 条件请求（304 不重下）。
- 启动时先同步用缓存渲染，再后台刷新；刷新完成后重绘。
- 抓不到（离线 / 站点故障）就用旧缓存；完全没数据就回退 `ctx.model.cost`，再没有就中性灰。
- 价格不硬编码在代码里；实时核对：`node scripts/preview.ts`。

## 7. pi 扩展 API 约束（已实测）

- **无法单独给 footer 里那个模型名换色**。只有两条路：
  - `ctx.ui.setStatus(key, text)` —— 在 footer 下加一行状态（本扩展采用）；
  - `ctx.ui.setFooter(...)` —— 整体替换 footer，需要自己重算 context 百分比、token 用量、成本。
- 相关事件：`session_start`、`model_select`（`event.source` ∈ `set` / `cycle` / `restore`）。
- `setStatus` 的文本会经过 sanitize（去掉 `\r\n\t` 并折叠空格），但 **ANSI 转义保留**，所以可以用颜色；pi-tui 的 `visibleWidth` 能正确计算含 ANSI 的宽度。
- 仅在 `ctx.hasUI` 为真时调用（JSON/print 模式无 UI）。
- 未启动会话的调用（如 `--list-models`）不会加载扩展，验证要用真实会话。
- 扩展在本仓根（入口 `index.ts` + `pricing.ts`），通过 `pi install git:github.com/zhaochunqi/pi-price-heat` 安装为 pi 包（`package.json` 的 `pi.extensions` 指向入口）；重开 pi 或 `/reload` 生效。

## 8. 验收标准

- 任何 Free 模型（如 `longcat-2.5-preview-free`）→ `severity = 0`，dim 绿，**不是红**。
- `kimi-k3`（3.00/15.00）→ `severity ≈ 0.97`，反白红。
- `deepseek-v4.1-flash`：Go（0.15/0.60）→ `severity ≈ 0.22`，浅黄绿；Zen（0.30/1.20）→ `≈ 0.38`。
- 无价格数据的模型 → 中性灰，不误判。
- **单调性**：对任意两个模型，`price` 更高的 `severity` 不许更低。
- 切换模型立即更新；启动/恢复会话时显示正确（有缓存则同步，首次跑完后台刷新再重绘）。

## 9. 开放问题

- 要不要顺带显示“本会话已花 / 月度额度剩余”？（models.dev 不含月度额度，需另接 opencode.ai 官网）
- 月度额度（$15/$60）要不要作为第二维信号（额度小的额外加深）？
- 要不要提供 `/price-heat` 命令切换模式或临时静音？
- 非 opencode provider 的兜底：也用 `ctx.model.cost` 上色阶，还是干脆不显示？（当前：有 `ctx.model.cost` 就上色阶）
