// scripts/test-worldcruise.mjs — world cruise channel routing tests.
// No framework. Run: node scripts/test-worldcruise.mjs
//
// The fetchImpl serves /api/world-cruises from the sibling World-Cruise-Atlas
// repo's query layer, so these tests exercise the real data contract without
// a deployed endpoint. Other channels return empty results.

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { searchOfferings, worldCruiseIntent, prioritizeMentionedPlace } from "../lib/search-offerings.js";

const require = createRequire(import.meta.url);
const atlas = require("../../World-Cruise-Atlas/lib/cruises.js");

const fetchImpl = async (url) => {
  const u = new URL(url);
  let body;
  if (u.pathname === "/api/world-cruises") {
    body = atlas.query(Object.fromEntries(u.searchParams));
  } else {
    body = { total: 0, count: 0, results: [], deepLink: null };
  }
  return { ok: true, json: async () => body };
};

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log("  ok  " + name); }

await test("worldCruiseIntent: strong phrases fire without cruise context", () => {
  assert.ok(worldCruiseIntent({ q: "world cruise 2027" }));
  assert.ok(worldCruiseIntent({ q: "a grand voyage next year" }));
  assert.ok(worldCruiseIntent({ q: "around the world cruise" }));
});

await test("worldCruiseIntent: bare ATW needs cruise context (jet keeps ATW)", () => {
  assert.ok(!worldCruiseIntent({ q: "around the world by private jet" }, "jet"));
  assert.ok(!worldCruiseIntent({ q: "around the world" }, "any"));
  assert.ok(worldCruiseIntent({ q: "around the world" }, "cruise"));
  assert.ok(worldCruiseIntent({ q: "circumnavigation by ship" }, "any"));
});

await test("type worldcruise searches the World Cruise Atlas", async () => {
  const r = await searchOfferings({ type: "worldcruise", limit: 3 }, { fetchImpl });
  assert.equal(r.type, "worldcruise");
  assert.ok(r.total >= 200);
  assert.equal(r.count, 3);
  assert.ok(r.results.every((x) => x.type === "worldcruise" && x.days >= 50));
  assert.ok(r.deepLink && r.deepLink.includes("world-cruise-atlas"));
});

await test("Regent world cruise beats the Luxury Cruise advisor guard", async () => {
  const r = await searchOfferings(
    { type: "cruise", q: "world cruise", brand: "Regent Seven Seas" },
    { fetchImpl }
  );
  assert.equal(r.type, "worldcruise");
  assert.ok(!r.advisorOnly);
  assert.ok(r.count > 0, "live Regent world cruises expected");
  assert.ok(r.results.every((x) => x.brand === "Regent Seven Seas"));
});

await test("ordinary Regent cruise ask stays advisor-led", async () => {
  const r = await searchOfferings(
    { type: "cruise", q: "Mediterranean cruise", brand: "Regent Seven Seas" },
    { fetchImpl }
  );
  assert.ok(r.advisorOnly, "non-world Regent asks remain advisor-led");
});

await test("region + month narrow the world cruise shortlist", async () => {
  const all = await searchOfferings({ type: "worldcruise", limit: 24 }, { fetchImpl });
  const med = await searchOfferings({ type: "worldcruise", region: "mediterranean", limit: 24 }, { fetchImpl });
  assert.ok(med.total > 0 && med.total < all.total);
  assert.ok(all.count <= 4);
  assert.ok(med.count <= 4);
  const jan = await searchOfferings({ type: "worldcruise", month: "2027-01", limit: 24 }, { fetchImpl });
  assert.ok(jan.total > 0);
  assert.ok(jan.count <= 4);
  assert.ok(jan.results.every((x) => x.month === "2027-01"));
});

await test("non-marquee regions (caribbean, alaska) stay binding", async () => {
  const carib = await searchOfferings({ type: "worldcruise", region: "caribbean", limit: 24 }, { fetchImpl });
  assert.ok(carib.total > 0);
  assert.ok(carib.results.every((x) => x.regionTags.includes("CARIB")));
  const alaska = await searchOfferings({ type: "worldcruise", region: "alaska", limit: 24 }, { fetchImpl });
  assert.ok(alaska.total > 0);
  assert.ok(alaska.results.every((x) => x.regionTags.includes("NAMWEST")));
});

await test("operator aliases resolve (cunard via queen mary)", async () => {
  const r = await searchOfferings(
    { type: "worldcruise", brand: "Queen Mary 2" },
    { fetchImpl }
  );
  assert.ok(r.count > 0);
  assert.ok(r.results.every((x) => x.brand === "Cunard"));
});

await test("prioritizeMentionedPlace reroutes world-cruise text", () => {
  const out = prioritizeMentionedPlace({ type: "cruise", q: "" }, "We want a world cruise in 2027");
  assert.equal(out.type, "worldcruise");
  const jet = prioritizeMentionedPlace({ type: "jet", world: true }, "around the world by private jet");
  assert.equal(jet.type, "jet");
});

await test("ATW jet input does not get hijacked by the world cruise channel", async () => {
  const r = await searchOfferings(
    { type: "jet", world: true, q: "around the world" },
    { fetchImpl }
  );
  assert.equal(r.type, "jet");
});

console.log(`\n${passed} tests passed`);
