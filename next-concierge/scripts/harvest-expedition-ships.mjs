#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const SAILINGS_PATH = new URL('../public/maps/cruise/sailings.json', import.meta.url);
const OUT_PATH = new URL('./cache/expedition-ship-map.json', import.meta.url);
const REPORT_PATH = new URL('./cache/expedition-ship-coverage.json', import.meta.url);

const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 6));
const LIMIT = Number(process.env.LIMIT || 0);
const REQUEST_TIMEOUT_MS = Math.max(5000, Number(process.env.REQUEST_TIMEOUT_MS || 20000));
const FORCE = process.argv.includes('--force');
const SKIP_PRODUCTS = process.argv.includes('--skip-products');
const INFER_ONLY = process.argv.includes('--infer-only');
const TODAY = new Date().toISOString().slice(0, 10);
const USER_AGENT = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
  'AppleWebKit/537.36 (KHTML, like Gecko)',
  'Chrome/126.0 Safari/537.36',
].join(' ');

class CookieJar {
  constructor() {
    this.cookies = new Map();
  }

  addFromHeaders(headers) {
    const raw = typeof headers.getSetCookie === 'function'
      ? headers.getSetCookie()
      : splitSetCookie(headers.get('set-cookie'));
    for (const item of raw) {
      const first = item.split(';')[0];
      const eq = first.indexOf('=');
      if (eq <= 0) continue;
      const key = first.slice(0, eq).trim();
      const value = first.slice(eq + 1).trim();
      if (!value || /max-age=0/i.test(item)) this.cookies.delete(key);
      else this.cookies.set(key, value);
    }
  }

  header() {
    return [...this.cookies].map(([key, value]) => `${key}=${value}`).join('; ');
  }
}

function splitSetCookie(value) {
  if (!value) return [];
  return value.split(/,(?=\s*[^;,\s]+=)/g).map(s => s.trim()).filter(Boolean);
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function getJsonLdBlocks(html) {
  const blocks = [];
  const re = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(html))) blocks.push(decodeHtml(match[1].trim()));
  return blocks;
}

function walkJson(value, visit) {
  if (!value || typeof value !== 'object') return;
  visit(value);
  if (Array.isArray(value)) {
    value.forEach(item => walkJson(item, visit));
  } else {
    Object.values(value).forEach(item => walkJson(item, visit));
  }
}

function extractShip(html) {
  for (const block of getJsonLdBlocks(html)) {
    try {
      const parsed = JSON.parse(block);
      let found = '';
      walkJson(parsed, obj => {
        if (found) return;
        const loc = obj.location;
        if (loc && typeof loc === 'object' && typeof loc.name === 'string') {
          found = loc.name.trim();
        }
      });
      if (found) return found;
    } catch {
      // Some Virtuoso pages carry non-critical JSON-LD formatting oddities.
    }
  }

  const meta = html.match(/<meta\b[^>]*(?:name|property)=["'](?:description|og:description|twitter:description)["'][^>]*content=["']([^"']+)["'][^>]*>/i)
    || html.match(/<meta\b[^>]*content=["']([^"']+)["'][^>]*(?:name|property)=["'](?:description|og:description|twitter:description)["'][^>]*>/i);
  if (meta) {
    const content = decodeHtml(meta[1]);
    const match = content.match(/\bCruise on the\s+.+?\s+ship\s+([^:]+):/i);
    if (match) return match[1].trim();
  }
  return '';
}

function schemaIndex(schema) {
  return Object.fromEntries(schema.map((name, index) => [name, index]));
}

async function loadJson(url, fallback) {
  try {
    return JSON.parse(await readFile(url, 'utf8'));
  } catch {
    return fallback;
  }
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchHtml(url, jar, attempt = 1) {
  let current = url;
  for (let redirect = 0; redirect < 5; redirect += 1) {
    const headers = {
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9',
      'user-agent': USER_AGENT,
    };
    const cookie = jar.header();
    if (cookie) headers.cookie = cookie;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(current, { headers, redirect: 'manual', signal: controller.signal });
    } catch (error) {
      clearTimeout(timer);
      if (attempt < 4) {
        await wait(900 * attempt);
        return fetchHtml(url, jar, attempt + 1);
      }
      throw error;
    }
    clearTimeout(timer);
    jar.addFromHeaders(response.headers);

    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      current = new URL(response.headers.get('location'), current).href;
      continue;
    }

    const html = await response.text();
    if (html.includes('Cookies Must Be Enabled') && attempt < 3) {
      await wait(350 * attempt);
      return fetchHtml(url, jar, attempt + 1);
    }
    if ((response.status === 429 || response.status >= 500) && attempt < 4) {
      await wait(900 * attempt);
      return fetchHtml(url, jar, attempt + 1);
    }
    return { status: response.status, url: current, html };
  }
  throw new Error(`Too many redirects: ${url}`);
}

async function saveCoverage(records, map) {
  const unresolvedDetails = records
    .filter(record => !map[record.id])
    .map(({ id, operator, url, productUrl }) => ({ id, operator, url, productUrl }));
  const sortedMap = Object.fromEntries(records
    .filter(record => map[record.id])
    .map(record => [record.id, map[record.id]]));
  const payload = {
    compiled: TODAY,
    source: 'virtuoso-advisor',
    map: sortedMap,
    unresolved: unresolvedDetails.map(item => item.id),
    coverage: {
      totalIds: records.length,
      resolved: Object.keys(sortedMap).length,
      unresolved: unresolvedDetails.length,
    },
    attempted,
    productMap,
    attemptedProducts,
    inferred,
    unresolvedDetails,
  };
  await mkdir(new URL('./cache/', import.meta.url), { recursive: true });
  await writeFile(OUT_PATH, `${JSON.stringify(payload, null, 2)}\n`);
  await writeFile(REPORT_PATH, `${JSON.stringify({
    compiled: TODAY,
    totalIds: records.length,
    resolved: Object.keys(sortedMap).length,
    unresolved: unresolvedDetails.length,
    unresolvedDetails,
  }, null, 2)}\n`);
  return payload;
}

const data = JSON.parse(await readFile(SAILINGS_PATH, 'utf8'));
const idx = schemaIndex(data.schema || []);
const existing = await loadJson(OUT_PATH, { map: {} });
const map = FORCE ? {} : { ...(existing.map || {}) };
const attempted = FORCE ? {} : { ...(existing.attempted || {}) };
const productMap = FORCE ? {} : { ...(existing.productMap || {}) };
const attemptedProducts = FORCE ? {} : { ...(existing.attemptedProducts || {}) };
const inferred = FORCE ? {} : { ...(existing.inferred || {}) };
const records = data.rows.map(row => {
  const id = String(row[idx.id]);
  const slug = row[idx.slug] || '';
  const product = row[idx.product] || '';
  return {
    id,
    operator: row[idx.operator] || '',
    name: row[idx.name] || '',
    start: row[idx.start] || '',
    nights: row[idx.nights] || '',
    region: row[idx.region] || '',
    product,
    url: slug ? `${data.urlBase}${id}/${slug}` : '',
    productUrl: product ? `${data.productBase}${product}` : '',
  };
});

const jar = new CookieJar();
const productShipCache = new Map();
let cursor = 0;
let done = 0;
let failed = 0;

if (!SKIP_PRODUCTS) {
  await harvestProductPages(records, jar);
  const filled = fillFromProductShips(records, map, productMap);
  if (filled.filled || filled.conflicts || filled.ambiguous) {
    await saveCoverage(records, map);
    console.log(`Product fill: ${filled.filled} ids filled, ${filled.ambiguous} ambiguous skipped, ${filled.conflicts} conflicts skipped.`);
  }
}

const initialConsensus = fillFromConsensus(records, map, inferred);
if (initialConsensus.filled) {
  await saveCoverage(records, map);
  console.log(`Consensus fill: ${initialConsensus.filled} ids filled (${initialConsensus.product} product, ${initialConsensus.sailing} duplicate sailing).`);
}

if (INFER_ONLY) {
  const payload = await saveCoverage(records, map);
  console.log(`Done. Resolved ${payload.coverage.resolved}/${payload.coverage.totalIds}; unresolved ${payload.coverage.unresolved}.`);
  process.exit(0);
}

const pending = records
  .filter(record => record.url && !map[record.id] && (!attempted[record.id] || attempted[record.id].status === 'error'))
  .slice(0, LIMIT > 0 ? LIMIT : undefined);

console.log(`Expedition ship harvest: ${records.length} ids, ${Object.keys(map).length} already resolved, ${pending.length} to fetch.`);
console.log(`Concurrency: ${CONCURRENCY}${LIMIT ? `, limit: ${LIMIT}` : ''}${SKIP_PRODUCTS ? ', product pass skipped' : ''}`);

async function worker(workerId) {
  while (cursor < pending.length) {
    const record = pending[cursor++];
    try {
      const result = await fetchHtml(record.url, jar);
      let ship = result.status === 404 ? '' : extractShip(result.html);
      if (!ship && record.productUrl) {
        ship = await productShip(record.productUrl, jar);
      }
      if (ship) {
        map[record.id] = ship;
        delete attempted[record.id];
      } else {
        attempted[record.id] = { status: 'unresolved', httpStatus: result.status, checked: TODAY };
        failed += 1;
        console.warn(`[${workerId}] unresolved ${record.id} ${record.operator} ${result.status} ${record.url}`);
      }
    } catch (error) {
      attempted[record.id] = { status: 'error', error: error.message, checked: TODAY };
      failed += 1;
      console.warn(`[${workerId}] error ${record.id} ${record.operator}: ${error.message}`);
    }
    done += 1;
    if (done % 50 === 0 || done === pending.length) {
      const payload = await saveCoverage(records, map);
      console.log(`Fetched ${done}/${pending.length}; resolved ${payload.coverage.resolved}/${payload.coverage.totalIds}; unresolved ${payload.coverage.unresolved}; failed this run ${failed}`);
    }
  }
}

function productShip(productUrl, jar) {
  if (!productShipCache.has(productUrl)) {
    productShipCache.set(productUrl, fetchHtml(productUrl, jar)
      .then(result => result.status === 404 ? '' : extractShip(result.html))
      .catch(error => {
        console.warn(`product fallback error ${productUrl}: ${error.message}`);
        return '';
      }));
  }
  return productShipCache.get(productUrl);
}

async function harvestProductPages(records, jar) {
  const products = [...new Map(records
    .filter(record => record.product && record.productUrl)
    .map(record => [record.product, { product: record.product, productUrl: record.productUrl }])).values()];
  const pendingProducts = products.filter(item => !productMap[item.product] && (!attemptedProducts[item.product] || attemptedProducts[item.product].status === 'error'));
  if (!pendingProducts.length) {
    console.log(`Product page pass: ${products.length} products, ${Object.keys(productMap).length} already resolved.`);
    return;
  }

  let productCursor = 0;
  let productDone = 0;
  let productFailed = 0;
  console.log(`Product page pass: ${products.length} products, ${pendingProducts.length} to fetch.`);

  async function productWorker(workerId) {
    while (productCursor < pendingProducts.length) {
      const item = pendingProducts[productCursor++];
      try {
        const result = await fetchHtml(item.productUrl, jar);
        const ship = result.status === 404 ? '' : extractShip(result.html);
        if (ship) {
          productMap[item.product] = ship;
          delete attemptedProducts[item.product];
        } else {
          attemptedProducts[item.product] = { status: 'unresolved', httpStatus: result.status, checked: TODAY };
          productFailed += 1;
          console.warn(`[product ${workerId}] unresolved ${item.product} ${result.status} ${item.productUrl}`);
        }
      } catch (error) {
        attemptedProducts[item.product] = { status: 'error', error: error.message, checked: TODAY };
        productFailed += 1;
        console.warn(`[product ${workerId}] error ${item.product}: ${error.message}`);
      }
      productDone += 1;
      if (productDone % 25 === 0 || productDone === pendingProducts.length) {
        await saveCoverage(records, map);
        console.log(`Product pages ${productDone}/${pendingProducts.length}; resolved products ${Object.keys(productMap).length}/${products.length}; failed this run ${productFailed}`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pendingProducts.length) }, (_, i) => productWorker(i + 1)));
}

function fillFromProductShips(records, map, productMap) {
  const directShipsByProduct = new Map();
  for (const record of records) {
    if (!record.product || !map[record.id]) continue;
    if (!directShipsByProduct.has(record.product)) directShipsByProduct.set(record.product, new Set());
    directShipsByProduct.get(record.product).add(map[record.id]);
  }

  let filled = 0;
  let ambiguous = 0;
  let conflicts = 0;
  for (const record of records) {
    if (!record.product || map[record.id] || !productMap[record.product]) continue;
    const known = directShipsByProduct.get(record.product);
    if (known && known.size > 1) {
      ambiguous += 1;
      continue;
    }
    if (known && known.size === 1 && !known.has(productMap[record.product])) {
      conflicts += 1;
      continue;
    }
    map[record.id] = productMap[record.product];
    filled += 1;
    if (!directShipsByProduct.has(record.product)) directShipsByProduct.set(record.product, new Set());
    directShipsByProduct.get(record.product).add(productMap[record.product]);
  }
  return { filled, ambiguous, conflicts };
}

function fillFromConsensus(records, map, inferred) {
  const result = { filled: 0, product: 0, sailing: 0 };

  const fill = (record, ship, source, extra) => {
    if (map[record.id] || !ship) return false;
    map[record.id] = ship;
    inferred[record.id] = { source, ship, checked: TODAY, ...extra };
    delete attempted[record.id];
    result.filled += 1;
    return true;
  };

  const byProduct = new Map();
  for (const record of records) {
    if (!record.product) continue;
    if (!byProduct.has(record.product)) byProduct.set(record.product, { records: [], ships: new Set() });
    const group = byProduct.get(record.product);
    group.records.push(record);
    if (map[record.id]) group.ships.add(map[record.id]);
  }

  for (const [product, group] of byProduct) {
    if (group.ships.size !== 1) continue;
    const ship = [...group.ships][0];
    for (const record of group.records) {
      if (fill(record, ship, 'product-consensus', { product })) result.product += 1;
    }
  }

  const bySailing = new Map();
  for (const record of records) {
    const key = [record.operator, record.name, record.start, record.nights, record.region].join('\t');
    if (!bySailing.has(key)) bySailing.set(key, { records: [], ships: new Set() });
    const group = bySailing.get(key);
    group.records.push(record);
    if (map[record.id]) group.ships.add(map[record.id]);
  }

  for (const [key, group] of bySailing) {
    if (group.records.length < 2 || group.ships.size !== 1) continue;
    const ship = [...group.ships][0];
    for (const record of group.records) {
      if (fill(record, ship, 'duplicate-sailing-consensus', { key })) result.sailing += 1;
    }
  }

  return result;
}

await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length || 1) }, (_, i) => worker(i + 1)));
const finalConsensus = fillFromConsensus(records, map, inferred);
if (finalConsensus.filled) {
  console.log(`Consensus fill: ${finalConsensus.filled} ids filled (${finalConsensus.product} product, ${finalConsensus.sailing} duplicate sailing).`);
}
const finalPayload = await saveCoverage(records, map);
console.log(`Done. Resolved ${finalPayload.coverage.resolved}/${finalPayload.coverage.totalIds}; unresolved ${finalPayload.coverage.unresolved}.`);
