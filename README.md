# pi-model-highlight

pi 扩展：让 footer 里的**当前模型**一眼可见——按**真实价格**分级，而不是按模型名猜。

状态：**需求整理阶段**，尚未实现。

## 要解决的问题

pi 的 footer 右侧会把当前模型名用 dim 灰色显示，切换模型时（`/model`、Ctrl+P 循环、恢复会话）很容易没注意到。使用者为此误用了好几次比 DeepSeek 贵的模型。

## 关键教训（第一版为什么被否）

第一版用模型名正则判断"便宜"（命中 `/deepseek/i` 就算便宜，其余一律红色）。这在根上就是错的：

- 免费模型也会被判红。例如 opencode-go 的 `longcat-2.5-preview-free`（官方报价 **Free**）被标成红色警告。
- 同名不同价：`mimo-v2.6-flash`（$0.14/$0.28）与 `mimo-v2.6-flash-free`（Free）靠名字区分不可靠。

所以：**分级只看价格，名字只用于展示。**

## 文档

- [`docs/requirements.md`](docs/requirements.md) — 需求、数据来源、验收标准、开放问题
- [`reference/`](reference/) — opencode-go / opencode zen 官方报价快照（自动生成，含出处与抓取日期）
  - 刷新：`python3 scripts/fetch-opencode-pricing.py`
