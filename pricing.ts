/**
 * Pure price -> heat-colour logic for pi-price-heat.
 *
 * No pi APIs, no I/O, no network: everything here is a deterministic function
 * so it can be unit-tested with `node --test`.
 *
 * Rule (docs/requirements.md §6): the colour is a function of the real token
 * price only. Model names are used for display, never for grading.
 */

/** One model's price in USD per 1M tokens. */
export interface PriceEntry {
	input: number;
	output: number;
	cacheRead?: number;
	/** Human-readable model name from the price source. */
	name?: string;
}

/** provider -> model id -> price. Keys are models.dev provider ids. */
export type PriceTable = Record<string, Record<string, PriceEntry>>;

/**
 * pi provider id -> models.dev provider id. Providers not listed here fall
 * back to `ctx.model.cost`. Membership doubles as the scope guardrail for
 * `catalogIsFlat`: only these catalogues are ever classified as flat plans.
 */
export const PROVIDER_MAP: Record<string, string> = {
	"opencode-go": "opencode-go",
	opencode: "opencode",
	// models.dev also has kimi-code-plan-global (kimi.ai); the catalogues are
	// identical today (all 0/0), so either would classify the same.
	"kimi-coding": "kimi-code-plan-cn",
	"github-copilot": "github-copilot",
	"zai-coding-cn": "zai-coding-plan",
	"xiaomi-token-plan-cn": "xiaomi-token-plan-cn",
	"xiaomi-token-plan-ams": "xiaomi-token-plan-ams",
	"xiaomi-token-plan-sgp": "xiaomi-token-plan-sgp",
	anthropic: "anthropic",
	openai: "openai",
	openrouter: "openrouter",
};

/** Log-scale floor: the cheapest paid model in opencode (Muse Spark, 0.10+0.20). */
export const LO_PRICE = 0.3;
/** Log-scale ceiling: "clearly expensive", ~= Kimi K3 (3+15=18); above this clamps to 1. */
export const HI_PRICE = 20.0;

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";

type Rgb = [number, number, number];
const GREEN: Rgb = [0x8c, 0xe9, 0x9a];
const YELLOW: Rgb = [0xff, 0xd4, 0x3b];
const RED: Rgb = [0xff, 0x55, 0x55];
const NEUTRAL: Rgb = [0xc8, 0xc8, 0xc8];
const PLAN: Rgb = [0x74, 0xc0, 0xfc];

/** Blended scalar price: input + output, $/1M tokens. */
export function priceOf(entry: { input: number; output: number }): number {
	return entry.input + entry.output;
}

/**
 * A provider catalogue has no price differentiation when it offers at most
 * one positive price point (all-free, or every paid model priced the same).
 * Heat is only meaningful where the user has a real choice; a flat catalogue
 * means "subscription with nothing to choose", which renders as `plan`
 * instead of the ramp. If the source later adds differentiated prices, the
 * classification changes on its own.
 */
export function catalogIsFlat(models: Record<string, PriceEntry> | undefined): boolean {
	if (!models) return false;
	const prices = new Set(
		Object.values(models)
			.map((entry) => priceOf(entry))
			.filter((price) => price > 0),
	);
	return prices.size <= 1;
}

/**
 * How a model's price resolved:
 * - `priced` — a real per-token price, coloured on the heat ramp;
 * - `plan` — a flat-price subscription catalogue: no actionable choice, so
 *   no heat, no banner, just a quiet marker;
 * - `unknown` — no price data, neutral grey, never judged.
 */
export type ResolvedPrice =
	| { kind: "priced"; entry: PriceEntry }
	| { kind: "plan" }
	| { kind: "unknown" };

/**
 * Map a scalar price to a 0..1 severity with a log scale.
 * Zero / negative (free) is exactly 0; anything at or above HI_PRICE is 1.
 */
export function severityOf(price: number): number {
	if (!(price > 0)) return 0;
	const lo = Math.log10(LO_PRICE);
	const hi = Math.log10(HI_PRICE);
	const severity = (Math.log10(price) - lo) / (hi - lo);
	return Math.min(1, Math.max(0, severity));
}

function mix(a: number, b: number, t: number): number {
	return Math.round(a + (b - a) * t);
}

/** Piecewise-linear RGB ramp: green -> yellow -> red. */
export function colorOf(severity: number): Rgb {
	const s = Math.min(1, Math.max(0, severity));
	const [from, to, t] = s <= 0.5 ? [GREEN, YELLOW, s / 0.5] : [YELLOW, RED, (s - 0.5) / 0.5];
	return [mix(from[0], to[0], t), mix(from[1], to[1], t), mix(from[2], to[2], t)];
}

/**
 * Wrap `text` in the ANSI colour for `severity`.
 *
 * - severity 0 (incl. free): dim green
 * - >= 0.7: bold
 * - >= 0.9: bold, white on the severity colour
 * - severity undefined: neutral dim grey (not part of the ramp)
 */
export function paint(text: string, severity: number | undefined): string {
	if (severity === undefined) {
		const [r, g, b] = NEUTRAL;
		return `${DIM}\x1b[38;2;${r};${g};${b}m${text}${RESET}`;
	}
	const [r, g, b] = colorOf(severity);
	if (severity >= 0.9) {
		return `${BOLD}\x1b[38;2;255;255;255m\x1b[48;2;${r};${g};${b}m${text}${RESET}`;
	}
	const attrs = `${severity >= 0.7 ? BOLD : ""}${severity <= 0 ? DIM : ""}`;
	return `${attrs}\x1b[38;2;${r};${g};${b}m${text}${RESET}`;
}

function formatNumber(value: number): string {
	return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));
}

/** `$0.15/$0.6` or `free`. */
export function formatPriceLabel(entry: PriceEntry): string {
	if (entry.input === 0 && entry.output === 0) return "free";
	return `$${formatNumber(entry.input)}/$${formatNumber(entry.output)}`;
}

/**
 * The footer status line: the model name painted by price plus a dim price
 * tag. Flat-plan models get a quiet dim-blue `plan` marker — the price is not
 * a decision the user can act on, so heat would be a false alarm. Unknown
 * price keeps the name only, in neutral grey.
 */
export function statusText(name: string, resolved: ResolvedPrice): string {
	if (resolved.kind === "plan") {
		const [r, g, b] = PLAN;
		return `${DIM}\x1b[38;2;${r};${g};${b}m${name} plan${RESET}`;
	}
	if (resolved.kind === "unknown") return paint(name, undefined);
	const severity = severityOf(priceOf(resolved.entry));
	return `${paint(name, severity)} ${DIM}${formatPriceLabel(resolved.entry)}${RESET}`;
}

/**
 * Price threshold for the above-editor banner: the same point where the ramp
 * turns bold (docs/requirements.md §6.3). Below it the footer status line is
 * enough; at or above it the model is worth an unmissable reminder.
 */
export const ALERT_SEVERITY = 0.7;

/**
 * The above-editor banner line, shown only for models expensive enough to warn
 * about. Cheap, free, flat-plan and unknown-priced models return undefined:
 * the banner must stay quiet so it never turns into decoration you learn to
 * ignore.
 */
export function alertText(name: string, resolved: ResolvedPrice): string | undefined {
	if (resolved.kind !== "priced") return undefined;
	const severity = severityOf(priceOf(resolved.entry));
	if (severity < ALERT_SEVERITY) return undefined;
	return paint(`⚠ ${name}  ${formatPriceLabel(resolved.entry)}`, severity);
}

/**
 * Slice a models.dev `api.json` payload down to the tracked providers.
 * Only providers present with a numeric `cost.input`/`cost.output` are kept.
 */
export function extractProviderPrices(raw: unknown, providers: readonly string[]): PriceTable {
	const root = raw as Record<string, { models?: Record<string, unknown> }> | undefined;
	const table: PriceTable = {};
	for (const provider of providers) {
		const models = root?.[provider]?.models;
		if (!models || typeof models !== "object") continue;
		const entries: Record<string, PriceEntry> = {};
		for (const [id, value] of Object.entries(models)) {
			const model = value as
				| { name?: unknown; cost?: { input?: unknown; output?: unknown; cache_read?: unknown } }
				| undefined;
			const cost = model?.cost;
			if (typeof cost?.input !== "number" || typeof cost?.output !== "number") continue;
			entries[id] = {
				input: cost.input,
				output: cost.output,
				cacheRead: typeof cost.cache_read === "number" ? cost.cache_read : undefined,
				name: typeof model?.name === "string" ? model.name : undefined,
			};
		}
		table[provider] = entries;
	}
	return table;
}
