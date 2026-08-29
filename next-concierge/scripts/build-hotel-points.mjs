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
const { applyHotelOverlays } = require("../lib/atlas/hotel-overlays.js");
// Umbrella-resort search names (Snowmass Village -> Aspen). Carried onto the
// point as `alias` so the map's own q haystack and the native adapter's
// searchText both see it without either re-reading the feed.
const { aliasText } = require("../lib/atlas/place-aliases.js");
// The property's preferred-partner amenity block, reduced to at most three card
// tags ("Daily breakfast · $100 credit · Room upgrade"). The prose stays in
// luxury-hotels.json for the dossier; only the tags ride on the point, which is
// what the card renders. Costs ~9 KB gzipped across 2,475 hotels.
const { hotelPerks } = require("../lib/atlas/hotel-perks.js");

const hotels = applyHotelOverlays(JSON.parse(fs.readFileSync(SOURCE, "utf8")));

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
        perks: hotelPerks(h),
        /*
         * The card's photograph, when there is one.
         *
         * `thumb` is a field on every one of the 2,475 records and is currently
         * empty on every one of them — the slot is cut and waiting for the
         * Virtuoso feed to fill it. Carrying it now means the day it has values
         * is a data change and not a code change: the adapter reads it, the
         * card's media slot renders it, and both already handle null.
         */
        thumb: h.thumb || null,
        // Whether a live Virtuoso offer is attached, so the rail's "Special
        // offers" toggle can filter without shipping the offers themselves.
        promo: h.hasPromotion ? 1 : 0,
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
