import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(ROOT, "data", "atlas", "hotel", "luxury-hotels.json");
const OUT = path.join(ROOT, "public", "maps", "hotel", "hotel-points.json");

const hotels = JSON.parse(fs.readFileSync(SOURCE, "utf8"));

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
