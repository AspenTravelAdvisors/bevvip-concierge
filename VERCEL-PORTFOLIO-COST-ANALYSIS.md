# Vercel Portfolio — Build Cost Analysis

Prepared 24 August 2026 from the `aspentraveladvisors` Vercel team and its linked
GitHub repositories. Figures are estimates for planning and valuation; they are not
a quotation or a formal appraisal.

**Headline:** ~4,300 hours to rebuild (range 3,600–5,000), at a blended
**$140/hour**, for a replacement cost of roughly **$600K**.

---

## 1. Measured inventory

All 23 linked repositories were cloned and counted directly. Line counts cover
hand-written source only — `node_modules`, build output, and the five vendored
copies of `leaflet.min.js` are excluded.

| Measure | Value |
| --- | --- |
| Vercel projects | 26 (23 linked repos, 3 direct deploys) |
| Hand-written code | 124,865 lines across 284 files |
| Net of cross-repo duplication | 96,334 lines (28,531 are copies) |
| Curated data | 154 MB JSON/GeoJSON (~45 MB unique) |
| Written specs | 5,374 lines of design docs and work orders |
| Elapsed build window | 21 weeks (27 Mar – 23 Aug 2026) |

The portfolio is one platform with a long tail, not 26 independent products.
`bevvip-concierge` alone is 54,226 lines — 43% of all code — carrying the
seven-vertical atlas, a Claude-powered guide, 7 API routes, 20 typed data adapters,
and 23 build/verify pipeline scripts against 2,475 hotels, 3,902 villas, a 250-port
world cruise itinerary, sea routing, and rail geometry.

### Measured duplication

Duplication was measured, not assumed: every code file was hashed for exact copies,
then same-path files were line-diffed across repositories to catch evolved forks.

| Lineage | Overlap |
| --- | --- |
| `basecamp` vs `bevvip-concierge` | 16,196 of 17,891 shared lines (91%) |
| 5 standalone atlases vs `public/maps/*` | 93–96% each |
| `packing-concierge` vs `PackingConciergeGPT` | 2,980 lines (97%) |
| `ShoreBookPolynesia` vs `ShoreBookAdriatic` | 1,498 lines (66%) |

Netting this out is what takes the count from 124,865 to 96,334, and it is why a
naive sum of the repositories overstates the work by roughly a quarter.

---

## 2. Hours by group

Bottom-up by component for the flagship, scaled by size and commit history for the
rest. Shared-lineage code is counted once, in the group that carries it.

| Group | Net lines | Low | High | Mid |
| --- | ---: | ---: | ---: | ---: |
| Concierge platform (bevvip-concierge, next-concierge) | 54,226 | 2,000 | 2,600 | 2,300 |
| Standalone atlases (hotel, cruise, jet, yacht, world cruise) | 13,600 | 500 | 750 | 625 |
| 3D & WebGL (vr-world, custom-rug, breakout, frogger) | 8,700 | 400 | 580 | 490 |
| AI concierge apps (packing x3, hotel-fit, m1agent) | 4,300 | 220 | 330 | 275 |
| Tools & games (supplier-rank, jet-lag, wordle, breathe) | 4,997 | 200 | 290 | 245 |
| Itinerary microsites (shore books, NatGeo jet) | 3,500 | 170 | 250 | 210 |
| Base Camp (predecessor deployment) | 1,940 | 80 | 140 | 110 |
| Unlinked deploys (toon-matrix, proxy-analysis) | — | 30 | 80 | 55 |
| **Total** | **96,334** | **3,600** | **5,020** | **4,310** |

**Cross-check.** 96,334 net lines over 4,310 hours is 22 lines an hour delivered —
including design, review, data curation, QA, and deployment. That sits in the right
band for component-heavy TypeScript/React with a lot of CSS and content. Traditional
hand-coded enterprise work runs 10–15 lines an hour, which would put the portfolio at
6,400–9,600 hours instead.

---

## 3. Blended hourly rate

US market ranges, 2026. These are estimates from market experience, not a live rate
survey — treat them as a bracket, not a quote.

| Discipline | Share | Range | Where it shows up |
| --- | ---: | ---: | --- |
| Senior full-stack | 40% | $110–170 | Next 15, React 19, TypeScript |
| Geospatial & mapping | 18% | $125–190 | Leaflet, Mapbox, Google 3D Tiles, sea routing |
| Data engineering | 15% | $95–150 | 23 pipeline scripts, port geocoding, QA |
| LLM integration | 9% | $135–200 | Claude guide, prompt design, rate limiting |
| WebGL / three.js | 8% | $115–180 | 360° archive, rug configurator, games |
| UI/UX design | 7% | $90–150 | 5,547-line design system, mobile atlas |
| QA & DevOps | 3% | $70–120 | 15 verify scripts, Vercel pipeline |
| **Blended** | 100% | **~$140** | weighted midpoint |

### Cost at 4,310 hours

| Sourcing tier | Range | Blended | Total |
| --- | ---: | ---: | ---: |
| US agency / consultancy | $175–275 | $210 | $905,000 |
| US senior independent / small studio | $110–175 | $140 | $603,000 |
| Nearshore (LatAm, Eastern Europe) | $55–95 | $72 | $310,000 |
| Offshore (South & Southeast Asia) | $30–60 | $43 | $185,000 |

For a portfolio this geospatially specific — sea routes that avoid land, 250 ports
whose coordinates had to be audited and corrected, hotel-to-brand-to-program mappings
across 2,475 properties — the offshore tier is the wrong bracket. **$140/hour is the
number to quote**, and $110 is a floor rather than a bargain.

---

## 4. Reconciliation — what it actually took

The estimate above answers "what would a shop charge to build this." The
repositories answer a different question, and the two numbers do not match.

The entire portfolio was built between **27 March and 23 August 2026** — 21 weeks —
by one to two people. The flagship carries 493 commits from four authors: 378 from
the account owner, 38 from a second contributor, and 69 co-authored by Claude. A
single operator working full time across that window spends roughly 850 hours; with
the second contributor, call it **900–1,400 hours actually spent**.

Against a 4,310-hour conventional estimate, that is a **three-to-five-times
productivity multiplier**.

Both numbers are true and used for different things:

- **4,300 hours / $600K** — replacement cost. For insurance, a balance sheet, an
  acquirer asking what it would cost to build rather than buy, or anyone quoting a rebuild.
- **900–1,400 hours** — cash-and-time cost actually incurred. For return on
  investment, and for deciding what to build next.

---

## 5. Method and known gaps

- All 23 linked repositories were cloned and counted directly; vendored and generated
  code excluded.
- Duplication was measured by content hash for exact copies, then same-path line-diff
  across repositories for evolved forks.
- Hours are bottom-up by component for the flagship (design system, atlas shell,
  adapter layer, 3D tiles, AI guide, API routes, pipelines, data curation, QA) and
  scaled by size and commit history for the rest.
- Data curation is costed as engineering time. 154 MB of hotel, villa, port, sailing
  and rail records did not arrive clean; the repository contains both an audit script
  and a correction script specifically for ports with wrong coordinates.

**Known gaps.** Three Vercel projects (`toon-matrix`, `proxy-analysis-progress`,
`next-concierge`) have no linked repository and are estimated by analogy. Commit
counts on repositories cloned at depth are floors, not totals. Market rates are
estimates from experience, not a live survey.
