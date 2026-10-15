/**
 * Live preview: fetch models.dev, compute a severity for every model in the
 * mapped providers and print them sorted by price. Providers whose catalogue
 * has no price differentiation are reported as flat plans instead. Useful for
 * eyeballing the heat ramp.
 *
 * Run: node scripts/preview.ts
 */

import {
	catalogIsFlat,
	extractProviderPrices,
	formatPriceLabel,
	paint,
	priceOf,
	PROVIDER_MAP,
	severityOf,
} from "../pricing.ts";

const API_URL = "https://models.dev/api.json";
const PROVIDERS = [...new Set(Object.values(PROVIDER_MAP))];

const response = await fetch(API_URL, { signal: AbortSignal.timeout(30_000) });
if (!response.ok) {
	console.error(`models.dev returned ${response.status}`);
	process.exit(1);
}

const table = extractProviderPrices(await response.json(), PROVIDERS);

for (const provider of PROVIDERS) {
	const models = table[provider];
	if (!models || Object.keys(models).length === 0) {
		console.log(`\n${provider}: no data`);
		continue;
	}
	if (catalogIsFlat(models)) {
		console.log(`\n${provider}: flat plan (${Object.keys(models).length} models, no price differentiation)`);
		continue;
	}
	const rows = Object.entries(models)
		.map(([id, entry]) => ({
			id,
			name: entry.name ?? id,
			price: priceOf(entry),
			severity: severityOf(priceOf(entry)),
			label: formatPriceLabel(entry),
		}))
		.sort((a, b) => a.price - b.price || a.id.localeCompare(b.id));
	console.log(`\n${provider} (${rows.length} models)`);
	for (const row of rows) {
		const severity = row.severity.toFixed(3);
		const painted = paint(row.name.padEnd(28), row.severity);
		console.log(`  ${severity}  ${painted} ${row.label}`);
	}
}
