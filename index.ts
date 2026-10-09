/**
 * pi-price-heat — colour the current model by its real price.
 *
 * The footer model name is dim grey in pi, which makes it easy to miss when
 * cycling models. This extension adds a status line that paints the model name
 * on a green -> yellow -> red heat ramp derived only from the token price.
 *
 * Prices are fetched dynamically from models.dev (https://models.dev), sliced
 * down to the tracked opencode providers, cached on disk and refreshed in the
 * background. Other providers fall back to `ctx.model.cost`; models with no
 * price at all get a neutral grey name and are never judged.
 *
 * See docs/requirements.md for the full spec.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	extractProviderPrices,
	type PriceEntry,
	type PriceTable,
	statusText,
} from "./pricing.ts";

const STATUS_KEY = "pi-price-heat";
const API_URL = "https://models.dev/api.json";
/** v1 scope: only opencode. Other providers use ctx.model.cost. */
const TRACKED_PROVIDERS = ["opencode-go", "opencode"] as const;
/** How long a cached table is trusted before we revalidate with models.dev. */
const REFRESH_TTL_MS = 12 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 20_000;

interface CacheFile {
	fetchedAt: string;
	etag?: string;
	providers: PriceTable;
}

type AnyModel = NonNullable<ExtensionContext["model"]>;

function cacheFile(): string {
	const base =
		process.env.XDG_CACHE_HOME ??
		(process.platform === "darwin"
			? join(homedir(), "Library", "Caches")
			: join(homedir(), ".cache"));
	return join(base, "pi-price-heat", "models-dev.json");
}

function loadCache(): CacheFile | undefined {
	try {
		const parsed = JSON.parse(readFileSync(cacheFile(), "utf8")) as CacheFile;
		if (parsed && typeof parsed === "object" && parsed.providers) return parsed;
	} catch {
		// No cache yet, or it is unreadable: fall back to ctx.model.cost.
	}
	return undefined;
}

function saveCache(cache: CacheFile): void {
	try {
		const target = cacheFile();
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, JSON.stringify(cache), "utf8");
	} catch {
		// A read-only cache dir is not fatal; prices still work in memory.
	}
}

function isFresh(cache: CacheFile | undefined): boolean {
	if (!cache?.fetchedAt) return false;
	const fetchedAt = Date.parse(cache.fetchedAt);
	return Number.isFinite(fetchedAt) && Date.now() - fetchedAt < REFRESH_TTL_MS;
}

async function fetchPrices(previous: CacheFile | undefined): Promise<CacheFile | undefined> {
	const headers: Record<string, string> = { accept: "application/json" };
	if (previous?.etag) headers["if-none-match"] = previous.etag;

	const response = await fetch(API_URL, {
		headers,
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
	});

	if (response.status === 304 && previous) {
		return { ...previous, fetchedAt: new Date().toISOString() };
	}
	if (!response.ok) return undefined;

	const providers = extractProviderPrices(await response.json(), TRACKED_PROVIDERS);
	if (Object.keys(providers).length === 0) return undefined;

	return {
		fetchedAt: new Date().toISOString(),
		etag: response.headers.get("etag") ?? undefined,
		providers,
	};
}

/** Prefer the models.dev table for opencode; otherwise fall back to ctx.model.cost. */
function resolve(model: AnyModel | undefined, table: PriceTable | undefined): PriceEntry | undefined {
	const provider = model?.provider;
	const id = model?.id;
	if (typeof provider === "string" && (TRACKED_PROVIDERS as readonly string[]).includes(provider)) {
		const entry = id ? table?.[provider]?.[id] : undefined;
		if (entry) return entry;
	}

	const cost = model?.cost;
	if (cost && (cost.input > 0 || cost.output > 0)) {
		return { input: cost.input, output: cost.output, cacheRead: cost.cacheRead };
	}
	return undefined;
}

export default function priceHeat(pi: ExtensionAPI): void {
	let cache: CacheFile | undefined;
	let table: PriceTable | undefined;
	let refreshInFlight: Promise<void> | undefined;
	let liveCtx: ExtensionContext | undefined;

	function render(ctx: ExtensionContext | undefined): void {
		if (!ctx?.hasUI) return;
		const model = ctx.model;
		if (!model) {
			ctx.ui.setStatus(STATUS_KEY, undefined);
			return;
		}
		const entry = resolve(model, table);
		const name = entry?.name ?? model.name ?? model.id ?? "model";
		ctx.ui.setStatus(STATUS_KEY, statusText(name, entry));
	}

	function refresh(): void {
		if (refreshInFlight) return;
		refreshInFlight = (async () => {
			try {
				const next = await fetchPrices(cache);
				if (!next) return;
				cache = next;
				table = next.providers;
				saveCache(next);
				render(liveCtx);
			} catch {
				// Offline / models.dev down: keep whatever we already had.
			} finally {
				refreshInFlight = undefined;
			}
		})();
	}

	pi.on("session_start", (_event, ctx) => {
		liveCtx = ctx;
		if (!cache) cache = loadCache();
		table = cache?.providers;
		render(ctx);
		if (!isFresh(cache)) refresh();
	});

	pi.on("model_select", (_event, ctx) => {
		liveCtx = ctx;
		render(ctx);
	});
}
