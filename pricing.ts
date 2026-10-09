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

/** provider -> model id -> price. */
export type PriceTable = Record<string, Record<string, PriceEntry>>;

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

/** Blended scalar price: input + output, $/1M tokens. */
export function priceOf(entry: { input: number; output: number }): number {
	return entry.input + entry.output;
}

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
 * The footer status line: the model name painted by price plus a dim price tag.
 * Unknown price keeps the name only, in neutral grey.
 */
export function statusText(name: string, entry: PriceEntry | undefined): string {
	if (!entry) return paint(name, undefined);
	const severity = severityOf(priceOf(entry));
	return `${paint(name, severity)} ${DIM}${formatPriceLabel(entry)}${RESET}`;
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
