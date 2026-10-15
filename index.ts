/**
 * pi-price-heat — colour the current model by its real price.
 *
 * The footer model name is dim grey in pi, which makes it easy to miss when
 * cycling models. This extension adds a status line that paints the model name
 * on a green -> yellow -> red heat ramp derived only from the token price, and
 * raises a banner above the editor whenever the current model is expensive
 * enough to be worth a second look.
 *
 * Prices are fetched dynamically from models.dev (https://models.dev) for the
 * providers in PROVIDER_MAP, cached on disk and refreshed in the background.
 * A mapped provider whose catalogue has no price differentiation (flat
 * subscription plans like kimi-coding) renders as a neutral "plan" marker
 * instead of the heat ramp — there is no price choice to warn about. Unmapped
 * providers fall back to `ctx.model.cost`; models with no price at all get a
 * neutral grey name and are never judged.
 *
 * See docs/requirements.md for the full spec.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	alertText,
	catalogIsFlat,
	extractProviderPrices,
	PROVIDER_MAP,
	type PriceTable,
	type ResolvedPrice,
	statusText,
} from "./pricing.ts";

const STATUS_KEY = "pi-price-heat";
const API_URL = "https://models.dev/api.json";
/** models.dev providers we fetch: the values of the pi -> models.dev map. */
const TRACKED_PROVIDERS = [...new Set(Object.values(PROVIDER_MAP))];
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
	if (!Number.isFinite(fetchedAt) || Date.now() - fetchedAt >= REFRESH_TTL_MS) return false;
	// A cache from before a provider was added to PROVIDER_MAP is stale.
	return TRACKED_PROVIDERS.every((provider) => cache.providers[provider]);
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

/**
 * Prefer the models.dev table for mapped providers. A flat catalogue (no
 * price differentiation, e.g. all-zero subscription plans) means the user has
 * no price choice to act on: report `plan` instead of judging by list price.
 * Unmapped providers and catalogue misses fall back to ctx.model.cost.
 */
function resolve(model: AnyModel | undefined, table: PriceTable | undefined): ResolvedPrice {
	const provider = model?.provider;
	const mapped = typeof provider === "string" ? PROVIDER_MAP[provider] : undefined;
	const catalog = mapped ? table?.[mapped] : undefined;
	if (catalog && Object.keys(catalog).length > 0) {
		if (catalogIsFlat(catalog)) return { kind: "plan" };
		const entry = model?.id ? catalog[model.id] : undefined;
		if (entry) return { kind: "priced", entry };
	}

	const cost = model?.cost;
	if (cost && (cost.input > 0 || cost.output > 0)) {
		return {
			kind: "priced",
			entry: { input: cost.input, output: cost.output, cacheRead: cost.cacheRead },
		};
	}
	return { kind: "unknown" };
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
			ctx.ui.setWidget(STATUS_KEY, undefined);
			return;
		}
		const resolved = resolve(model, table);
		const name =
			(resolved.kind === "priced" ? resolved.entry.name : undefined) ??
			model.name ??
			model.id ??
			"model";
		ctx.ui.setStatus(STATUS_KEY, statusText(name, resolved));
		// The footer is easy to miss; an expensive model gets a banner right above
		// the editor. Cheap/free/flat-plan/unknown models clear it so it stays
		// meaningful.
		const alert = alertText(name, resolved);
		ctx.ui.setWidget(STATUS_KEY, alert ? [alert] : undefined);
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
