# Virtuoso Partner API — Protocol Reference

**Discovered:** 2026-08-25 · **Agency:** Aspen Travel Advisors
**Base:** `https://api.virtuoso.com` · **Docs:** `/documentation` (requires Virtuoso SSO login)
Credentials live in `next-concierge/.env.local` as `VIRTUOSO_API_*` (gitignored). Never commit them.

## Authentication — two steps

**1. Build an auth token.** AES-256-CBC (PKCS7) encrypt this JSON with the supplied key + IV, base64 the result:

```json
{"APIKey":"<VIRTUOSO_API_KEY>","CurrentTimeUtc":"<ISO 8601 UTC>"}
```

**2. Exchange it for a bearer token** — note the parameter is `user`, not `apiUser`:

```
GET /v2/login?authToken=<urlencoded base64>&user=Aspen%20Travel%20Advisors
```

Returns `{ serverUtcTime, status, result: { bearerToken } }`.

### Traps that cost real time
- **The parameter is `user`.** `apiUser`, `apiuser`, `userName` all yield a bodyless `500` — indistinguishable from a bad token, so failures here look like encryption bugs and send you down the wrong path.
- **A bodyless `500` is the generic failure.** It means "missing parameter" *or* "decryption failed" *or* "malformed JSON". It never says which.
- **Bearer tokens are single-use.** Every successful response carries a fresh token at the **top level** as `token` — not inside `result`. Reuse the old one and you get `401 Bearer-Token not valid`. This forces requests to be **strictly sequential**; there is no safe parallelism.
- Tokens expire after 5 minutes; re-login on expiry.
- The bearer token is passed as a **query param** `?token=`, not an `Authorization` header.
- The jsfiddle Virtuoso links from the docs shows single-quoted JSON. Standard double-quoted JSON works fine (their own C# sample uses `JsonConvert`).

## Endpoints (v2; v1 mirrors it)

Search endpoints (plural) and detail endpoints (singular):

| Search | Detail | Notes |
|---|---|---|
| `/v2/hotels` | `/v2/hotel?id=` | 2,073 properties |
| `/v2/cruises` | `/v2/cruise?id=` | |
| `/v2/packages` | `/v2/package?id=` | tours / jet / rail journeys |
| `/v2/promotions` | `/v2/promotion?id=` | |
| `/v2/services` | `/v2/service?id=` | |
| `/v2/advisors` | `/v2/advisor?id=`, `/v2/advisor/reviews` | |
| `/v2/gts` | — | global text search across product types |
| `/v2/locations/countries`, `/v2/locations/regions` | — | reference data |

### Query parameters
- `rowsPerPage` + `startRow` — pagination. **Not** `pageSize`/`limit`/`take`, all of which are silently ignored and return the default 10 rows. A single call with `rowsPerPage=2500` returns the entire hotel catalog in ~1s.
- `searchRegions` — business region filter, e.g. `US & Canada`.
- `queryForFilters=true` — returns the facet catalog instead of results.
- `returnFields` — limit facet categories, using the display name (e.g. `Length`).
- String params are case-sensitive unless stated otherwise.

### Measured performance
- Full hotel catalog (2,073 rows, summary fields): **~1s in one call**.
- Detail call: **~800ms**, sequential only → a full detail crawl of every hotel is **~28 minutes**. Practical for a nightly job; do incremental refreshes otherwise.

## Hotel detail payload (`/v2/hotel`)

The fields that matter for BeVvip:

- **Photos** — `defaultImageUrl`, `imageLibraryItems[]` (url + caption; 38 for a sample property), `supplierVideos[]`, `supplierLogo`
- **Supplier classification** (replaces our AI guesses) — `hotelExperiences[]` (Adventure, Beach, City Life, Ecotourism, Golf, Landmarks, Local Immersion, Seclusion, Ski, Wellness), `hotelVibes[]` (Casual, Hip, Sophisticated, Zen), `roomStyle[]` (Classic, Contemporary, Eclectic, Indigenous), `hotelFeatures[]` (66 flags), `propertyType`
- **Perks, authoritative** — `virtuosoAmenitiesHtml` carries the real, year-stamped Virtuoso benefits. This supersedes our `vipUpgrades`.
- **Identity for dedupe** — `productId`, `companyId`, `companyName`, `propertyChainName`
- **Geo** — `latitude`, `longitude` (strings, space-padded), `countryCodeISO3`, `subdivisionCode`, `supplierPostalCode`
- **Editorial prose for guide search** — `propertySummaryHtml`, `asSeenInTravelFolioDescription`, `asSeenInTravelFolioInTheKnow`
- **Rooms** — `guestRooms[]` with per-room-type amenities / services / features
- **Other** — `numberOfRooms`, `nearestAirportDescription`, `nearestAirportDistanceInMiles`, `sustainabilityCertifications[]`, `supplierSustainability`, `reviewsInfoJson`, `joinDate`, `companyInfo` (phones, emails)

Search rows (`/v2/hotels`) carry a lighter set: `id`, `name`, `title`, `company`, `defaultImageUrl`, `experiences[]`, `businessRegions[]`, `type`, `hasVirtuosoBenefits`, and `location` as a **stringified JSON** blob (`{"City":…,"State":…,"Country":…,"StateAbbr":…}`) that must be parsed.
