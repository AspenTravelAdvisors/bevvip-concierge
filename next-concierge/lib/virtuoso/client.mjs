// Virtuoso Partner API client.
//
// Two things shape this file. Bearer tokens are single-use — every successful
// response carries the next one at the top level as `token` — so requests must
// run strictly sequentially; there is no safe parallelism. And the API answers
// every kind of failure with a bodyless 500, so errors here are deliberately
// verbose about what was attempted.
//
// Protocol notes: Master Documents/Virtuoso_API_Reference.md

import crypto from 'node:crypto';

const BASE = process.env.VIRTUOSO_API_BASE || 'https://api.virtuoso.com';

/*
 * Virtuoso rolls maintenance one instance at a time behind its load balancer.
 * A request that lands on a draining instance is 301'd to an Azure maintenance
 * host, and following that redirect ends in "redirect count exceeded" — which
 * reads like a client bug and is really "try again, you will get a healthy
 * instance". Redirects are therefore handled manually so this is retryable
 * rather than fatal, which matters most for the unattended nightly sync.
 */
const MAINTENANCE_HOST = /maintenance[^/]*\.azurewebsites\.net/i;

class MaintenanceError extends Error {
  constructor(path) {
    super(`Virtuoso ${path} hit an instance in maintenance`);
    this.retryable = true;
  }
}

/** fetch that refuses to chase a maintenance redirect. */
async function fetchNoMaintenance(url, init, path) {
  const res = await fetch(url, { ...init, redirect: 'manual' });
  if (res.status >= 300 && res.status < 400) {
    const to = res.headers.get('location') ?? '';
    if (MAINTENANCE_HOST.test(to)) throw new MaintenanceError(path);
    // Any other redirect is followed once, normally.
    return fetch(to || url, init);
  }
  return res;
}

function credentials() {
  const user = process.env.VIRTUOSO_API_USER;
  const key = process.env.VIRTUOSO_API_KEY;
  const aesKey = process.env.VIRTUOSO_API_AES_KEY;
  const aesIv = process.env.VIRTUOSO_API_AES_IV;
  const missing = Object.entries({ VIRTUOSO_API_USER: user, VIRTUOSO_API_KEY: key, VIRTUOSO_API_AES_KEY: aesKey, VIRTUOSO_API_AES_IV: aesIv })
    .filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new Error(`Missing Virtuoso credentials: ${missing.join(', ')}. Set them in .env.local or as CI secrets.`);
  return { user, key, aesKey: Buffer.from(aesKey, 'base64'), aesIv: Buffer.from(aesIv, 'base64') };
}

function authToken({ key, aesKey, aesIv }) {
  const plain = JSON.stringify({ APIKey: key, CurrentTimeUtc: new Date().toISOString() });
  const cipher = crypto.createCipheriv('aes-256-cbc', aesKey, aesIv);
  return Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]).toString('base64');
}

export function createClient({ retries = 10, log = () => {} } = {}) {
  const creds = credentials();
  let bearer = null;
  let issuedAt = 0;
  let queue = Promise.resolve();      // serializes every call — tokens are single-use

  async function login() {
    // `user`, not `apiUser`. The wrong name returns a bodyless 500 that looks
    // exactly like an encryption failure.
    const qs = new URLSearchParams({ authToken: authToken(creds), user: creds.user });
    const res = await fetchNoMaintenance(`${BASE}/v2/login?${qs}`, {}, '/v2/login');
    const body = await res.text();
    if (!res.ok) throw new Error(`Virtuoso login failed: HTTP ${res.status}${body ? ` — ${body.slice(0, 200)}` : ' (bodyless — check the `user` param and the AES key/IV)'}`);
    const json = JSON.parse(body);
    bearer = json?.result?.bearerToken;
    if (!bearer) throw new Error(`Virtuoso login returned no bearerToken: ${body.slice(0, 200)}`);
    issuedAt = Date.now();
    log('virtuoso: logged in');
    return bearer;
  }

  // Tokens die after 5 minutes; re-login early rather than burn a request.
  const stale = () => !bearer || Date.now() - issuedAt > 4 * 60 * 1000;

  async function request(path, params) {
    if (stale()) await login();
    const qs = new URLSearchParams({ ...params, token: bearer });
    const res = await fetchNoMaintenance(`${BASE}${path}?${qs}`, {}, path);
    const body = await res.text();

    if (res.status === 401) {            // token consumed or expired — re-login once
      await login();
      const retryQs = new URLSearchParams({ ...params, token: bearer });
      const retryRes = await fetchNoMaintenance(`${BASE}${path}?${retryQs}`, {}, path);
      const retryBody = await retryRes.text();
      if (!retryRes.ok) throw new Error(`Virtuoso ${path} failed after re-login: HTTP ${retryRes.status} ${retryBody.slice(0, 200)}`);
      return consume(retryBody, path);
    }
    if (!res.ok) throw new Error(`Virtuoso ${path} failed: HTTP ${res.status}${body ? ` — ${body.slice(0, 200)}` : ' (bodyless — usually a bad or missing parameter)'}`);
    return consume(body, path);
  }

  function consume(body, path) {
    let json;
    try { json = JSON.parse(body); }
    catch { throw new Error(`Virtuoso ${path} returned non-JSON: ${body.slice(0, 200)}`); }
    if (json.token) { bearer = json.token; issuedAt = Date.now(); }   // rotate
    return json;
  }

  // Every call goes through one chain, so concurrent callers can't race the token.
  function call(path, params = {}) {
    const result = queue.then(async () => {
      let lastError;
      for (let attempt = 1; attempt <= retries; attempt++) {
        try { return await request(path, params); }
        catch (err) {
          lastError = err;
          if (attempt < retries) {
            /*
             * Retry a maintenance redirect almost immediately.
             *
             * Virtuoso drains one instance at a time behind a load balancer, so
             * a redirect means "you hit the wrong one", not "the API is down" —
             * the very next request usually lands somewhere healthy. Backing off
             * five seconds and upward turned a 1.7-second call into a
             * 25-second one and was the single biggest drag on the crawl.
             * Still doubles, so a genuine full outage backs off properly.
             */
            const wait = err instanceof MaintenanceError
              ? Math.min(250 * 2 ** (attempt - 1), 8000)
              : 500 * 2 ** (attempt - 1);
            log(`virtuoso: ${path} attempt ${attempt} failed (${err.message}); retrying in ${wait}ms`);
            await new Promise(r => setTimeout(r, wait));
            bearer = null;                // force a fresh token on retry
          }
        }
      }
      throw lastError;
    });
    queue = result.then(() => {}, () => {});   // keep the chain alive past failures
    return result;
  }

  return {
    call,
    login,
    /** Every row of a search endpoint. The catalog is small enough to come back in one call. */
    async searchAll(path, params = {}) {
      const first = await call(path, { ...params, rowsPerPage: 2500, startRow: 0 });
      const { totalRows = 0, data = [] } = first.result ?? {};
      const rows = [...data];
      while (rows.length < totalRows) {
        const next = await call(path, { ...params, rowsPerPage: 2500, startRow: rows.length });
        const batch = next.result?.data ?? [];
        if (!batch.length) break;         // defensive: never spin on an empty page
        rows.push(...batch);
      }
      return { totalRows, rows };
    },
    /** Facet catalog for a search endpoint — the valid values for each filter. */
    async filters(path, returnFields) {
      const res = await call(path, returnFields ? { queryForFilters: 'true', returnFields } : { queryForFilters: 'true' });
      return res.result?.data ?? [];
    },
  };
}
