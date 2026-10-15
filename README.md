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

When the current model is expensive (`severity ≥ 0.7`), it also raises a banner **directly above the editor** (`setWidget`), where you cannot miss it while typing:

```
⚠ Kimi K3  $3/$15
╭──────────────────────────────╮
│ Type your message…           │
╰──────────────────────────────╯
```

The banner stays absent for cheap, free and unknown-priced models, so it remains a real signal instead of permanent decoration.

- Ramp: `severity = clamp((log10(input + output) - log10(0.30)) / (log10(20) - log10(0.30)), 0, 1)`
- Colour: pale green `#8ce99a` → yellow `#ffd43b` → red `#ff5555`; `≥ 0.7` is bold, `≥ 0.9` is bold with reversed colours.
- Free (`0/0`) is always `severity = 0` and is **never** red.
- No price data → neutral grey, never judged.
- Flat subscription plans (kimi-coding, zai, xiaomi token plans — catalogues with no price differentiation) → a quiet dim-blue `plan` marker, never heat, never a banner: with nothing to choose, price is not a signal.

Scope: providers in `PROVIDER_MAP` (`pricing.ts`) are priced from models.dev — `opencode-go` / `opencode`, `github-copilot`, `kimi-coding`, `zai-coding-cn`, `xiaomi-token-plan-*`, plus the per-token `anthropic` / `openai` / `openrouter`. Other providers fall back to `ctx.model.cost`.

## Where prices come from

[models.dev](https://models.dev) — fetched at runtime from `https://models.dev/api.json`, sliced down to the mapped providers (see `PROVIDER_MAP` in `pricing.ts`; pi provider ids are translated to models.dev ids, e.g. `kimi-coding` → `kimi-code-plan-cn`):

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
node scripts/preview.ts         # fetch models.dev and list every mapped provider's models with price + severity
```

- `index.ts` — the pi extension glue: live price fetch, cache, `setStatus` + above-editor `setWidget` banner.
- `pricing.ts` — pure functions: price → severity → ANSI colour (no pi, no I/O, directly unit-testable).
- `pricing.test.ts` — unit tests.
- `scripts/preview.ts` — live preview.

## License

[MIT](LICENSE)
