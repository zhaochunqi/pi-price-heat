# pi-price-heat

pi 扩展：footer 里的**当前模型**按**真实价格**染成一条色阶——越贵越深、越便宜越浅，免费最浅。

不是"高亮某个模型"，而是"价格 → 颜色深浅"的单调映射：不按模型名猜，只按价格算。

[English](README.md) · [设计说明](docs/requirements.md)

## 效果

footer 下多一行状态（`setStatus`）：

```
Kimi K3 $3/$15                 ← 白字红底，一眼看到"贵"
MiMo-V2.6-Flash $0.14/$0.28    ← 浅绿
LongCat 2.5 Preview Free free  ← dim 绿，放心
```

当当前模型偏贵（`severity ≥ 0.7`）时，**输入框正上方**再多一条横幅（`setWidget`），打字时不可能错过：

```
⚠ Kimi K3  $3/$15
╭──────────────────────────────╮
│ 输入你的消息…                  │
╰──────────────────────────────╯
```

便宜 / 免费 / 无价格的模型不出横幅，保证它一直是"信号"而不是常驻装饰。

- 色阶：`severity = clamp((log10(input+output) - log10(0.30)) / (log10(20) - log10(0.30)), 0, 1)`
- 颜色：浅绿 `#8ce99a` → 黄 `#ffd43b` → 红 `#ff5555`；≥0.7 加粗，≥0.9 反白。
- 免费（0/0）恒为 `severity = 0`，**永不判红**。
- 无价格 → 中性灰，不判色。
- 无价格分化的订阅 plan（kimi-coding、zai、xiaomi token plan 等目录内只有一个价位的）→ 安静的 dim 蓝 `plan` 标记：没有可选择的空间，价格就不是信号，**不上色阶、不出横幅**。

范围：`PROVIDER_MAP`（`pricing.ts`）里的 provider 走 models.dev 查价——`opencode-go` / `opencode`、`github-copilot`、`kimi-coding`、`zai-coding-cn`、`xiaomi-token-plan-*`，以及按量计费的 `anthropic` / `openai` / `openrouter`；其它 provider 走 `ctx.model.cost` 兜底。

## 价格来源

**models.dev**，运行时动态获取（`https://models.dev/api.json`），切出映射的 provider（见 `pricing.ts` 的 `PROVIDER_MAP`，pi 的 provider id 会翻译成 models.dev 的 id，如 `kimi-coding` → `kimi-code-plan-cn`）：

- 落盘缓存 `$XDG_CACHE_HOME/pi-price-heat/models-dev.json`（macOS 无 XDG 时 `~/Library/Caches/...`），12h 内直接用；过期后用 `If-None-Match` 条件刷新。
- 离线/站点故障用旧缓存；完全没有则回退 `ctx.model.cost`，再没有就中性灰。
- 不硬编码价格。实时核对：`node scripts/preview.ts`。

> models.dev 每个模型只给一档价。Go 的 DeepSeek V4.1 Flash 因此是 off-peak `$0.15/$0.60`（severity ≈0.22），Zen 是 peak `$0.30/$1.20`（≈0.38）。

## 安装

作为一个 pi 包安装（git source）：

```bash
pi install git:github.com/zhaochunqi/pi-price-heat
```

写入 `~/.pi/agent/settings.json` 的 `packages`；重开 pi 或 `/reload` 生效。升级：`pi update`。

临时试用（不写 settings）：

```bash
pi -e git:github.com/zhaochunqi/pi-price-heat
```

## 开发

```bash
node --test pricing.test.ts     # 纯逻辑单测（severity / 色阶 / 单调性 / 解析）
node scripts/preview.ts         # 拉 models.dev，列出所有映射 provider 的模型价格与 severity
```

- `index.ts` —— pi 扩展胶水：动态取价、缓存、`setStatus`。
- `pricing.ts` —— 纯函数：价格 → severity → ANSI 颜色（无 pi、无 I/O，可直接单测）。
- `pricing.test.ts` —— 单测。
- `scripts/preview.ts` —— 实时预览。

## 许可

[MIT](LICENSE)
