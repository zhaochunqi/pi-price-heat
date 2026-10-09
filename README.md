# pi-price-heat

A [pi](https://pi.dev) extension that colours the **current model** in the footer by its **real price** — the more expensive the model, the hotter the colour. Free models stay the palest.

This is not "highlight one model": it is a monotonic **price → colour intensity** mapping. It never guesses from the model name or vendor, only from the price.

[中文说明](README.zh-CN.md) · [Design notes](docs/requirements.md)

## What it looks like

The extension adds a status line below the footer (`setStatus`):

```
Kimi K3 $3/$15                 ← white on red: expensive at a glance
MiMo-V2.6-Flash $0.14/$0.28    ← pale green
LongCat 2.5 Preview Free free  ← dim green, safe to use
```

- Ramp: `severity = clamp((log10(input + output) - log10(0.30)) / (log10(20) - log10(0.30)), 0, 1)`
- Colour: pale green `#8ce99a` → yellow `#ffd43b` → red `#ff5555`; `≥ 0.7` is bold, `≥ 0.9` is bold with reversed colours.
- Free (`0/0`) is always `severity = 0` and is **never** red.
- No price data → neutral grey, never judged.

Scope: **v1 covers opencode models only** (`opencode-go` / `opencode`); other providers fall back to `ctx.model.cost`.

## Where prices come from

[models.dev](https://models.dev) — fetched at runtime from `https://models.dev/api.json`, sliced down to the `opencode-go` / `opencode` providers:

- Cached on disk at `$XDG_CACHE_HOME/pi-price-heat/models-dev.json` (`~/Library/Caches/...` on macOS without XDG); reused for 12h, then revalidated with `If-None-Match`.
- Offline or upstream down → keep using the stale cache; with no cache at all it falls back to `ctx.model.cost`, and finally to neutral grey.
- Prices are never hard-coded. Check them live with `node scripts/preview.ts`.

> models.dev gives one price tier per model, so DeepSeek V4.1 Flash shows off-peak `$0.15/$0.60` on Go (severity ≈ 0.22) and peak `$0.30/$1.20` on Zen (≈ 0.38).

## Install

Install as a pi package (git source):

```bash
pi install git:github.com/zhaochunqi/pi-price-heat
```

This writes a `packages` entry to `~/.pi/agent/settings.json`. Restart pi or run `/reload` to pick it up. Update later with `pi update`.

Try it for a single session without touching settings:

```bash
pi -e git:github.com/zhaochunqi/pi-price-heat
```

## Development

```bash
node --test pricing.test.ts     # pure logic: severity / ramp / monotonicity / parsing
node scripts/preview.ts         # fetch models.dev and list every opencode model with price + severity
```

- `index.ts` — the pi extension glue: live price fetch, cache, `setStatus`.
- `pricing.ts` — pure functions: price → severity → ANSI colour (no pi, no I/O, directly unit-testable).
- `pricing.test.ts` — unit tests.
- `scripts/preview.ts` — live preview.

## License

[MIT](LICENSE)
