import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(ROOT, "data", "atlas", "hotel", "luxury-hotels.json");
const OUT = path.join(ROOT, "public", "maps", "hotel", "hotel-points.json");

// Same program overlay the query layer applies (lib/atlas/hotels.js), so the
// map's "Brand / Program" facet and the API cannot disagree about which program
// a property belongs to.
const { applyProgramOverrides } = require("../lib/atlas/program-overrides.js");
// Umbrella-resort search names (Snowmass Village -> Aspen). Carried onto the
// point as `alias` so the map's own q haystack and the native adapter's
// searchText both see it without either re-reading the feed.
const { aliasText } = require("../lib/atlas/place-aliases.js");

const hotels = applyProgramOverrides(JSON.parse(fs.readFileSync(SOURCE, "utf8")));

const features = hotels
  .map((h) => {
    const lat = Number(h.lat);
    const lng = Number(h.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return {
      type: "Feature",
      geometry: { type: "Point", coordinates: [lng, lat] },
      properties: {
        id: h.id || "",
        name: h.name || "",
        brand: h.brand || null,
        program: h.program || null,
        category: h.category || null,
        country: h.country || null,
        city: h.city || null,
        region: h.adminRegion || null,
        marqueeRegion: h.region || null,
        alias: aliasText(h) || null,
      },
    };
  })
  .filter(Boolean);

const collection = {
  type: "FeatureCollection",
  total: features.length,
  features,
};

fs.writeFileSync(OUT, `${JSON.stringify(collection)}\n`);
console.log(`Wrote ${features.length.toLocaleString()} hotel points to ${path.relative(ROOT, OUT)}`);
