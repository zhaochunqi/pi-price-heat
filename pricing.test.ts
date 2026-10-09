import assert from "node:assert/strict";
import { test } from "node:test";
import {
	colorOf,
	extractProviderPrices,
	formatPriceLabel,
	paint,
	priceOf,
	severityOf,
	statusText,
} from "./pricing.ts";

const close = (actual: number, expected: number) =>
	assert.ok(Math.abs(actual - expected) < 0.005, `${actual} !~= ${expected}`);

test("free is exactly 0 and never red", () => {
	const severity = severityOf(priceOf({ input: 0, output: 0 }));
	assert.equal(severity, 0);
	assert.deepEqual(colorOf(severity), [0x8c, 0xe9, 0x9a]);
	const painted = paint("LongCat", severity);
	assert.ok(painted.includes("\x1b[2m"), "free should be dim");
	assert.ok(painted.includes("38;2;140;233;154"), "free should be green");
	assert.ok(!painted.includes("38;2;255;85;85"), "free must not be red");
});

test("anchors from docs/requirements.md §6.4", () => {
	close(severityOf(priceOf({ input: 0.1, output: 0.2 })), 0); // muse-spark floor
	close(severityOf(priceOf({ input: 0.14, output: 0.28 })), 0.08); // mimo-v2.6-flash
	close(severityOf(priceOf({ input: 0.15, output: 0.5 })), 0.18); // glm-5.3-flash
	close(severityOf(priceOf({ input: 3, output: 15 })), 0.97); // kimi-k3
	assert.equal(severityOf(priceOf({ input: 30, output: 180 })), 1); // gpt-5.4-pro clamps
});

test("severity is monotonic in price", () => {
	const prices = [0, 0.1, 0.3, 0.42, 0.65, 0.75, 1.5, 4.95, 5.8, 8, 18, 210];
	let previous = -1;
	for (const price of prices) {
		const severity = severityOf(price);
		assert.ok(severity >= previous, `${price} made severity go down`);
		previous = severity;
	}
});

test("colour ramp endpoints", () => {
	assert.deepEqual(colorOf(0), [0x8c, 0xe9, 0x9a]);
	assert.deepEqual(colorOf(0.5), [0xff, 0xd4, 0x3b]);
	assert.deepEqual(colorOf(1), [0xff, 0x55, 0x55]);
});

test("expensive models get bold and inverse", () => {
	const kimi = paint("Kimi K3", severityOf(18));
	assert.ok(kimi.includes("\x1b[1m"), ">=0.9 should be bold");
	assert.ok(kimi.includes("48;2;"), ">=0.9 should paint a background");
});

test("price labels", () => {
	assert.equal(formatPriceLabel({ input: 0, output: 0 }), "free");
	assert.equal(formatPriceLabel({ input: 3, output: 15 }), "$3/$15");
	assert.equal(formatPriceLabel({ input: 0.15, output: 0.6 }), "$0.15/$0.6");
});

test("status text keeps the name and a dim price tag", () => {
	const text = statusText("Kimi K3", { input: 3, output: 15 });
	assert.ok(text.includes("Kimi K3"));
	assert.ok(text.includes("$3/$15"));
	const unknown = statusText("mystery", undefined);
	assert.ok(unknown.includes("mystery"));
	assert.ok(unknown.includes("\x1b[2m"));
});

test("extracts only tracked providers with numeric costs", () => {
	const raw = {
		"opencode-go": {
			models: {
				"kimi-k3": { name: "Kimi K3", cost: { input: 3, output: 15, cache_read: 0.3 } },
				"no-cost": { name: "No Cost" },
			},
		},
		opencode: { models: { "big-pickle": { name: "Big Pickle", cost: { input: 0, output: 0 } } } },
		anthropic: { models: { "claude-x": { cost: { input: 1, output: 2 } } } },
	};
	const table = extractProviderPrices(raw, ["opencode-go", "opencode"]);
	assert.deepEqual(Object.keys(table).sort(), ["opencode", "opencode-go"]);
	assert.deepEqual(table["opencode-go"]["kimi-k3"], {
		input: 3,
		output: 15,
		cacheRead: 0.3,
		name: "Kimi K3",
	});
	assert.equal(table["opencode-go"]["no-cost"], undefined);
	assert.equal(table.anthropic, undefined);
});
