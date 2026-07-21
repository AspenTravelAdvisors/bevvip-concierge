#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';

const PUBLIC_PATH = new URL('../public/maps/cruise/sailings.json', import.meta.url);
const DATA_PATH = new URL('../data/atlas/cruise/sailings.json', import.meta.url);
const MAP_PATH = new URL('./cache/expedition-ship-map.json', import.meta.url);
const SHIPS_PATH = new URL('../data/atlas/cruise/ships.json', import.meta.url);

function schemaIndex(schema) {
  return Object.fromEntries(schema.map((name, index) => [name, index]));
}

function readJson(url) {
  return readFile(url, 'utf8').then(JSON.parse);
}

function orderedSchema(schema) {
  const base = schema.filter(name => name !== 'ship');
  const productIndex = base.indexOf('product');
  if (productIndex === -1) throw new Error('sailings schema is missing product');
  base.splice(productIndex + 1, 0, 'ship');
  return base;
}

function bakeShips(data, shipMap) {
  const outSchema = orderedSchema(data.schema || []);
  const oldIndex = schemaIndex(data.schema || []);
  const rows = data.rows.map(row => {
    const values = {};
    for (const [name, index] of Object.entries(oldIndex)) values[name] = row[index];
    const id = String(values.id || '');
    return outSchema.map(name => name === 'ship' ? (shipMap[id] || '') : (values[name] ?? ''));
  });
  return { ...data, schema: outSchema, rows };
}

function distinctByOperator(data) {
  const idx = schemaIndex(data.schema || []);
  const out = new Map();
  for (const row of data.rows || []) {
    const op = row[idx.operator] || '';
    const ship = idx.ship == null ? '' : (row[idx.ship] || '');
    if (!out.has(op)) out.set(op, new Set());
    if (ship) out.get(op).add(ship);
  }
  return out;
}

function printCounts(title, counts) {
  console.log(`\n${title}`);
  [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([operator, ships]) => {
      console.log(String(ships.size).padStart(3), operator);
      if (ships.size) console.log(`    ${[...ships].sort().join(', ')}`);
    });
}

function normShip(name) {
  return String(name || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function expandedCatalogNames(ship) {
  if (ship === 'Ponant Explorers class (Le Bellot, Le Jacques-Cartier + 4 sisters)') {
    return ['Le Bellot', 'Le Bougainville', 'Le Champlain', "Le Dumont-d'Urville", 'Le Jacques-Cartier', 'Le Laperouse', 'Le Lapérouse'];
  }
  if (ship === "Sisterships Le Boréal / L'Austral / Le Soléal / Le Lyrial") {
    return ['Le Boréal', "L'Austral", 'Le Soléal', 'Le Lyrial'];
  }
  if (ship === 'World Navigator / World Traveller / World Voyager / World Seeker') {
    return ['World Navigator', 'World Traveller', 'World Voyager', 'World Seeker'];
  }
  if (ship === 'Aria Amazon / Aqua Nera') {
    return ['Aria Amazon', 'Aqua Nera'];
  }
  return ship.split(/\s+\/\s+/).map(s => s.trim()).filter(Boolean);
}

function knownFleetByOperator(catalog) {
  const known = new Map();
  for (const entry of catalog.ships || []) {
    if (!known.has(entry.operator)) known.set(entry.operator, new Map());
    for (const name of expandedCatalogNames(entry.ship)) {
      known.get(entry.operator).set(normShip(name), name);
    }
  }
  return known;
}

function reviewUnknownShips(data, catalog) {
  const known = knownFleetByOperator(catalog);
  const idx = schemaIndex(data.schema || []);
  const unknown = new Map();
  for (const row of data.rows || []) {
    const operator = row[idx.operator] || '';
    const ship = row[idx.ship] || '';
    if (!ship) continue;
    const fleet = known.get(operator);
    if (!fleet || !fleet.has(normShip(ship))) {
      if (!unknown.has(operator)) unknown.set(operator, new Set());
      unknown.get(operator).add(ship);
    }
  }
  if (!unknown.size) {
    console.log('\nKnown-fleet review: no uncataloged harvested ships.');
    return;
  }
  console.log('\nKnown-fleet review: uncataloged harvested ships to review');
  [...unknown.entries()].sort((a, b) => a[0].localeCompare(b[0])).forEach(([operator, ships]) => {
    console.log(`  ${operator}: ${[...ships].sort().join(', ')}`);
  });
}

const [publicData, mapData, catalog] = await Promise.all([
  readJson(PUBLIC_PATH),
  readJson(MAP_PATH),
  readJson(SHIPS_PATH),
]);

if (!mapData || !mapData.map) throw new Error(`Missing ship map at ${MAP_PATH.pathname}`);

const before = distinctByOperator(publicData);
const baked = bakeShips(publicData, mapData.map);
const after = distinctByOperator(baked);
const body = `${JSON.stringify(baked)}\n`;

await Promise.all([
  writeFile(PUBLIC_PATH, body),
  writeFile(DATA_PATH, body),
]);

printCounts('Before distinct ship counts per operator', before);
printCounts('After distinct ship counts per operator', after);
reviewUnknownShips(baked, catalog);

const unresolved = baked.rows.filter(row => !row[schemaIndex(baked.schema).ship]).length;
console.log(`\nWrote ${PUBLIC_PATH.pathname}`);
console.log(`Wrote ${DATA_PATH.pathname}`);
console.log(`Ship coverage: ${baked.rows.length - unresolved}/${baked.rows.length} resolved; ${unresolved} unresolved.`);
