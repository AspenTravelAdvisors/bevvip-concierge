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

export function createClient({ retries = 3, log = () => {} } = {}) {
  const creds = credentials();
  let bearer = null;
  let issuedAt = 0;
  let queue = Promise.resolve();      // serializes every call — tokens are single-use

  async function login() {
    // `user`, not `apiUser`. The wrong name returns a bodyless 500 that looks
    // exactly like an encryption failure.
    const qs = new URLSearchParams({ authToken: authToken(creds), user: creds.user });
    const res = await fetch(`${BASE}/v2/login?${qs}`);
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
    const res = await fetch(`${BASE}${path}?${qs}`);
    const body = await res.text();

    if (res.status === 401) {            // token consumed or expired — re-login once
      await login();
      const retryQs = new URLSearchParams({ ...params, token: bearer });
      const retryRes = await fetch(`${BASE}${path}?${retryQs}`);
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
            const wait = 500 * 2 ** (attempt - 1);
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
