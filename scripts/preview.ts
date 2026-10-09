/**
 * Live preview: fetch models.dev, compute a severity for every tracked model
 * and print them sorted by price. Useful for eyeballing the heat ramp.
 *
 * Run: node scripts/preview.ts
 */

import { extractProviderPrices, formatPriceLabel, paint, priceOf, severityOf } from "../pricing.ts";

const API_URL = "https://models.dev/api.json";
const PROVIDERS = ["opencode-go", "opencode"] as const;

const response = await fetch(API_URL, { signal: AbortSignal.timeout(30_000) });
if (!response.ok) {
	console.error(`models.dev returned ${response.status}`);
	process.exit(1);
}

const table = extractProviderPrices(await response.json(), PROVIDERS);
const rows = Object.entries(table).flatMap(([provider, models]) =>
	Object.entries(models).map(([id, entry]) => ({
		provider,
		id,
		name: entry.name ?? id,
		price: priceOf(entry),
		severity: severityOf(priceOf(entry)),
		label: formatPriceLabel(entry),
	})),
);
rows.sort((a, b) => a.price - b.price || a.id.localeCompare(b.id));

console.log(`${rows.length} models from ${PROVIDERS.join(", ")}\n`);
for (const row of rows) {
	const severity = row.severity.toFixed(3);
	const painted = paint(row.name.padEnd(28), row.severity);
	console.log(`${severity}  ${painted} ${row.provider.padEnd(12)} ${row.label}`);
}
