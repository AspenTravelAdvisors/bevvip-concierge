// lib/atlas/index.js — in-process atlas dispatcher.
//
// next-concierge serves all five atlas query backends itself (no external
// *.vercel.app deploys). Each backend lib exposes the identical contract the
// old HTTP APIs did — query(params) -> { total, count, results, deepLink } and
// regions() -> { total, count, regions } — so The Guide's data layer and the
// hotel iframe can call them in-process instead of over the network.

const hotel = require("./hotels");
const cruise = require("./cruises-expedition");
const jet = require("./journeys");
const yacht = require("./sailings");
const worldcruise = require("./cruises-world");
const train = require("./trains");

const BACKENDS = { hotel, cruise, jet, yacht, worldcruise, train };

function backendFor(type) {
  const b = BACKENDS[String(type || "").trim()];
  if (!b) throw new Error(`unknown atlas type: ${type}`);
  return b;
}

// Filter, search, paginate over a type's inventory.
// Returns { total, count, results, deepLink }.
function queryAtlas(type, params = {}) {
  return backendFor(type).query(params || {});
}

// Per-marquee-region aggregate for a type (resting-state map counts).
function regionsFor(type) {
  return backendFor(type).regions();
}

// Single record by id (hotel only today; others have no per-record endpoint).
function getById(type, id) {
  const b = backendFor(type);
  return typeof b.getById === "function" ? b.getById(id) : null;
}

module.exports = { queryAtlas, regionsFor, getById, BACKENDS };
