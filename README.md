# pi-price-heat

pi 扩展：footer 里的**当前模型**按**真实价格**染成一条色阶——越贵越深、越便宜越浅，免费最浅。

不是"高亮某个模型"，而是"价格 → 颜色深浅"的单调映射：不按模型名猜，只按价格算。

状态：**需求整理阶段**，尚未实现。

## 要解决的问题

pi 的 footer 右侧会把当前模型名用 dim 灰色显示，切换模型时（`/model`、Ctrl+P 循环、恢复会话）很容易没注意到。使用者为此误用了好几次比 DeepSeek 贵的模型。

## 关键教训（第一版为什么被否）

第一版用模型名正则判断"便宜"（命中 `/deepseek/i` 就算便宜，其余一律红色）。这在根上就是错的：

- 免费模型也会被判红。例如 opencode-go 的 `longcat-2.5-preview-free`（官方报价 **Free**）被标成红色警告。
- 同名不同价：`mimo-v2.6-flash`（$0.14/$0.28）与 `mimo-v2.6-flash-free`（Free）靠名字区分不可靠。

所以：**分级只看价格，名字只用于展示。**

## 名字

`pi-price-heat`：price + heat，指"价格热度色阶"。曾用名 `pi-model-highlight`（不准确：重点不是 highlight 某个模型，而是按价格给出深浅）。

## 文档

- [`docs/requirements.md`](docs/requirements.md) — 需求、数据来源、验收标准、开放问题
- [`reference/`](reference/) — opencode-go / opencode zen 官方报价快照（自动生成，含出处与抓取日期）
  - 刷新：`python3 scripts/fetch-opencode-pricing.py`
