# BeVvip — TravelWits API Integration Strategy & Code-Change Plan

**Prepared:** May 31, 2026
**Scope:** Full system — Custom GPT + standalone Vercel app + advisor layer
**Trigger:** TravelWits (the engine behind VipTravelAi.com) is adding an API for real-time hotel/cruise rates, availability, and booking.

This document does three things: (1) judges whether the existing two-surface blueprint is still the right direction, (2) recommends the architecture for plugging the TravelWits API into both surfaces, and (3) specifies the concrete code changes each surface needs once the API is live.

---

## 1. The one-paragraph answer

The blueprint is strategically correct and you should keep it. The two-surface split — **GPT discovers/qualifies/routes, app compares/unlocks/books, advisor closes complex** — matches how luxury buyers actually behave and maps cleanly onto a live API. But the blueprint describes a *destination*, and the current code is built on a workaround that the API makes obsolete. The single most important change is this: **today both surfaces invent rates with an LLM (`gpt-4.1` writing estimated markdown tables and `VHOTEL` tokens). Once TravelWits is live, the app must stop inventing rates entirely and render real ones from the API.** Everything else in this plan follows from that one shift. The good news is that because TravelWits is a CADENCE-connected, Sabre-partnered *agency* engine — not a generic OTA — its live rates can be the preferred/consortia rates that already carry your VIP perks and IATA attribution. That removes the usual "live rates kill the perks story" conflict before it starts.

---

## 2. What TravelWits is, and why it changes the architecture in your favor

From their materials, TravelWits is an AI-powered, one-stop search-and-book platform built *for travel agencies and advisors*, aggregating supplier data behind a modern UX. Two facts matter most for your build:

- **CADENCE is a named client.** Aspen Travel Advisors is a CADENCE affiliate. That strongly implies TravelWits surfaces consortia/preferred content and books under the agency's credentials — so rates pulled through it can be *the same preferred rates that carry the perks*, not stripped public rates.
- **It carries a Sabre Developer Partner badge.** Hotel content and booking are likely Sabre-backed plus aggregation. Sabre is strong for hotels, flights, and cars; it is *not* a real-time cruise engine. Expect hotels to be fully live-bookable and cruise to be partial or absent at launch.

**Consequence for your value proposition:** the worry that "real-time rates" would force you to show public OTA prices without upgrades, breakfast, and credits does **not** apply here, *provided the displayed rate is the TravelWits/consortia rate*. Live rates and "same as direct + VIP perks" become the same thing rather than competing claims. This is the strongest argument for routing all hotel booking through TravelWits rather than bolting on a third-party hotel API.

**The critical open question (resolve before any code):** does TravelWits expose a **programmatic REST API** you can call server-side, or only a **white-label client portal with deep links**? The plan below is written to handle both, because it determines how much you render yourself versus hand off.

---

## 3. Is the blueprint correct? — Assessment

**Keep, with conviction:**

- The complementary (not equal) two-surface model. Forcing nuanced luxury buyers through a filter grid, or forcing ready-to-book shoppers through an open-ended chat, both reduce conversion. The split is right.
- The three monetization lanes: scalable hotel passive income (Lane A), high-value advisor leads (Lane B), cruise-as-hybrid (Lane C). The API supercharges Lane A specifically.
- Doctrine 6 — *protected rates governed by backend rules, not model improvisation.* This is the most important doctrine in the whole document and the API makes it enforceable for the first time.
- The gated-rate unlock concept. Today it's fiction (there are no real protected rates to gate). With TravelWits + consortia pricing it becomes real and compliant: show public/BAR rate openly, reveal the preferred rate + perks after capture/login.

**Correct / sharpen given the API:**

1. **The app is described as a "structured search and comparison surface" but is currently a chat box.** The blueprint's app modules (Search / Compare / Unlock / Handoff / Capture) don't exist in `public/index.html` yet — it's a chat UI plus a Google Maps layer driven by a hidden comment tag. The API is the right moment to build the actual search surface the blueprint always intended. Don't bolt live rates onto the chatbot; build the structured layer underneath and keep chat as an optional "need help choosing?" assistant.

2. **Stop the LLM from being the rate source on the app.** `api/prompt.js` Section 5 ("ALWAYS display EXACTLY 3 room tiers," fabricated `~$X/night est.` tables, "NEVER say pricing unavailable") is exactly right for a knowledge-only demo and exactly wrong the moment real inventory exists. Estimated tables next to a "real-time rates" promise is a trust and (for preferred rates) a compliance problem. These rules must be retired on the app and replaced by "defer all pricing to the live results panel."

3. **Cruise is correctly a hybrid — lean into that, don't force it live.** Because Sabre/TravelWits likely won't give true real-time luxury/expedition cruise availability at launch, the blueprint's instinct (cruise = live browse where possible, advisor capture otherwise) is the right call. Resist the temptation to fake cruise live-rates the way the current prompt fakes hotel rates.

4. **One business brain needs to become a real file, not a principle.** The blueprint says both surfaces should "share one business brain." Today they share nothing — `api/prompt.js` and the live GPT instructions have already drifted (the master doc v3 flags this). Make the shared rules a single committed config (luxury threshold, perk language, rate-display policy, escalation triggers) that the backend enforces and both prompts reference.

**One direction change worth considering:** the blueprint treats the GPT and app as separate funnels that hand off via links. With an API and Custom GPT **Actions**, the GPT can show a live "from $X tonight" anchor itself (read-only, public rate only) before routing to the app to compare/unlock/book. That tightens the funnel without violating Doctrine 1 (GPT clarifies and classifies, app is the checkout). Recommended, but as a later phase — not launch.

---

## 4. Target architecture

```
                    ┌─────────────────────────────────────────────┐
                    │           SHARED BUSINESS BRAIN              │
                    │   business-rules.json (single source)        │
                    │   luxury threshold · perk language ·         │
                    │   rate-display policy · escalation triggers  │
                    └───────────────┬──────────────┬──────────────┘
                                    │              │
              ┌─────────────────────┘              └─────────────────────┐
              ▼                                                          ▼
   ┌──────────────────────┐                              ┌──────────────────────────┐
   │     CUSTOM GPT        │                              │   STANDALONE APP (Vercel) │
   │  discovery · qualify  │                              │  structured search · book │
   │  · route              │                              │                           │
   │                       │                              │  • /api/search  (live)    │
   │  Action → /api/quote  │                              │  • /api/chat    (assist)  │
   │  (public "from $X")   │                              │  • /api/unlock  (gated)   │
   └──────────┬────────────┘                              │  • /api/handoff (book)    │
              │                                           └────────────┬──────────────┘
              │  routes user to app / advisor                          │
              ▼                                                        ▼
   ┌──────────────────────────────────────────────────────────────────────────────┐
   │                       BeVvip BACKEND ORCHESTRATION                              │
   │   • normalizes TravelWits responses → BeVvip response contract                  │
   │   • enforces rate-display policy (public vs preferred/gated)                    │
   │   • applies luxury filter + curation tags                                       │
   │   • preserves IATA / advisor attribution on every handoff                       │
   │   • logs events (search, unlock, handoff) for analytics + lead scoring          │
   └───────────────┬─────────────────────────────────────────────┬─────────────────┘
                   ▼                                               ▼
        ┌────────────────────┐                         ┌────────────────────────┐
        │  TravelWits API     │  hotels (live)          │  Advisor layer / CRM   │
        │  (VipTravelAi.com)  │  cruise (partial/none)  │  structured brief sink │
        └────────────────────┘                         └────────────────────────┘
                   │ cruise/expedition/tour
                   ▼
        ┌────────────────────┐
        │  Virtuoso deep      │  (keep existing VCRUISE/VTOUR tokens until a
        │  links / advisor    │   real cruise feed exists)
        └────────────────────┘
```

**Core principle:** the LLM never sees, invents, or displays a protected rate. It produces *intent* (structured search parameters) and *prose* (positioning, value framing). The backend produces *rates*. This is Doctrine 6 made real, and it's the spine of the whole design.

---

## 5. The BeVvip response contract

Replace the fragile `<!--BEVVIP_HOTELS:[…]-->` comment tag and the markdown rate tables with one normalized JSON object that the backend returns and the front end renders. The backend builds this from TravelWits; nothing downstream parses LLM prose for data.

```jsonc
{
  "query": { "destination": "Paris, France", "checkin": "2026-09-10",
             "checkout": "2026-09-14", "adults": 2, "children": 0, "rooms": 1 },
  "results": [
    {
      "id": "tw_hotel_12345",
      "name": "Four Seasons Hotel George V",
      "city": "Paris, France",
      "lat": 48.8686, "lng": 2.3009,
      "luxuryTier": "ultra",                 // ultra | luxury (sub-threshold filtered out)
      "ataVisited": true,                    // drives the "Visited by Aspen Travel Advisors" line
      "curationTags": ["Most romantic", "Best for upgrades"],
      "perks": ["Room upgrade on arrival", "Daily breakfast for two",
                "$100 property credit", "Early check-in / late checkout"],
      "rooms": [
        { "type": "Superior Room", "rateType": "public",
          "nightlyFrom": 1450, "currency": "USD", "cancellation": "Free until 48h",
          "preferredAvailable": true },
        { "type": "Deluxe Suite", "rateType": "public",
          "nightlyFrom": 2900, "currency": "USD", "cancellation": "Free until 48h",
          "preferredAvailable": true }
      ],
      "preferred": null,                     // null until unlocked; then mirrors rooms[] w/ preferred rate
      "photos": ["https://…"],
      "bookingHandoffUrl": "https://www.VipTravelAi.com/book?ref=…&hotel=tw_hotel_12345&…"
    }
  ],
  "policy": { "showPreferred": false, "disclaimer": "Public flexible rate shown. Eligible guests can unlock a preferred rate with VIP benefits." }
}
```

Key fields and why they exist: `rateType`/`preferred`/`policy.showPreferred` implement gated rates compliantly; `bookingHandoffUrl` is built server-side so attribution can never be dropped; `luxuryTier`/`curationTags`/`ataVisited` carry the brand intelligence the blueprint calls for (Section 17 ranking, the curation labels, the "Visited by Aspen Travel Advisors" list) instead of burying it in a prompt.

---

## 6. Code changes — standalone app

### 6.1 New: `api/search.js` (the heart of the change)
Server-side function that does what the LLM does today, but with real data:
- Accepts a structured query (destination, dates, occupancy, rooms, filters) — from either the search form or a chat tool call.
- Calls TravelWits server-side using `TRAVELWITS_API_KEY` (never exposed to the browser).
- Normalizes the TravelWits payload into the §5 response contract.
- Applies the **luxury filter** (drop anything below threshold), attaches **curation tags** and the **ATA-visited** flag from the shared list, and enforces the **rate-display policy**: if the session is not unlocked, strip preferred rates and set `policy.showPreferred = false`.
- Builds each `bookingHandoffUrl` with advisor/IATA attribution baked in.
- Logs a `search` event for analytics/lead scoring.

If TravelWits ships only a portal (no API), `api/search.js` instead returns curated content + perks + a deep link to the live rate on VipTravelAi.com, and the "render real rates natively" goal is deferred. **This is the fork to confirm in Phase 0.**

### 6.2 New: `api/unlock.js`
Lead capture → mints a short-lived session token → subsequent `/api/search` calls include preferred rates (`policy.showPreferred = true`). This is what makes the gated-rate concept real. Capture writes a lead record (Phase 5 CRM sink).

### 6.3 New: `api/handoff.js` (or a signed URL builder)
Constructs/redirects to the VipTravelAi.com booking URL with attribution + the selected room/rate, and logs a `handoff` event. Keeping this server-side guarantees attribution survives and gives you the conversion metric the blueprint's KPI section wants.

### 6.4 Rewrite: `api/prompt.js`
This file is currently a rate-fabrication engine. Strip it down to a *positioning* engine:
- **Delete** Section 5 (estimated room-tier tables, `~$X/night est.`, "NEVER say pricing unavailable") — the search panel now owns pricing.
- **Delete** the hotel `VHOTEL` token rules and the `<!--BEVVIP_HOTELS-->` map tag — both are replaced by the structured `/api/search` response.
- **Keep** brand voice, the luxury threshold, perk *language*, the ATA-visited list (or better, move it into `business-rules.json`), and routing logic.
- **Add** a tool/function definition `search_hotels(destination, checkin, checkout, adults, children, rooms, filters)` so the assistant, when a user gives concrete parameters in chat, emits a tool call instead of prose rates. The front end (or `chat.js`) executes it against `/api/search` and renders real cards.
- **Keep** `VCRUISE`/`VTOUR` → Virtuoso tokens *for now* (no live cruise feed yet).

### 6.5 Upgrade: `api/chat.js`
Today it's a pure pass-through stream. Two options:
- **Phase 1 (simplest):** leave `chat.js` as-is for prose; the new structured search UI calls `/api/search` directly. Decouples live rates from the LLM immediately with minimal risk.
- **Phase 2 (conversational live rates):** make `chat.js` tool-call aware — detect `tool_calls` in the stream, execute `search_hotels` against `/api/search`, feed results back, continue streaming. This lets users ask "show me live rates in Cabo next weekend" in chat and get real cards.

Recommend Phase 1 first.

### 6.6 Rebuild: `public/index.html`
The 2,048-line single file needs the blueprint's app modules added:
- **Search module:** destination, dates, occupancy/rooms, luxury filters.
- **Results grid:** real cards rendered from the `/api/search` contract — perks, real `nightlyFrom`, rate type, cancellation, curation tags, ATA-visited badge.
- **Compare view:** 2–4 cards side-by-side (perks, cancellation, rate type, room type).
- **Unlock CTA + lead form:** calls `/api/unlock`, then re-renders with preferred rates.
- **Booking handoff button:** hits `/api/handoff`.
- **Map:** keep Google Maps, but drive it from the `/api/search` results array instead of the hidden comment tag.
- **Chat:** demote to an optional "Need help choosing?" assistant panel.

Strongly recommend breaking this into components (the master doc v3 already flags the single-file problem) rather than growing the monolith — but at minimum, add the search panel + a renderer over the structured response.

---

## 7. Code changes — Custom GPT

The GPT stays in its lane (discovery, qualification, routing) and should *not* become a booking surface. Two changes:

1. **Add an Action (OpenAPI schema) → read-only `/api/quote`.** A public, un-gated endpoint that returns *only* "starting from" public rates + availability for a destination/date. This lets the GPT anchor with a real number ("Suites at the George V start around $X for your dates") instead of a hallucinated one — killing the same fabrication problem on the GPT side. **Never expose gated/preferred rates through the GPT Action** (no session/auth in ChatGPT = compliance risk). Preferred rates live behind the app's unlock only.

2. **Update the GPT instructions** (the live `GPT Instructions` config) so that: when dates are concrete, it calls the Action for a live anchor; it *never* invents exact rates; it routes hotels to the app to compare/unlock/book; and it keeps cruise/tour/expedition on the advisor + Virtuoso path. This is mostly tightening what the current instructions already say ("prefer live Virtuoso-aligned search," "do not present estimated rates as live") — now it's enforceable because there's a real endpoint.

---

## 8. Shared business brain — `business-rules.json`
Extract from both prompts into one committed file the backend enforces and both surfaces reference: luxury threshold + sub-threshold redirect language, canonical perk wording, the ATA preferred/visited property lists, rate-display policy (public-always, preferred-on-unlock), and escalation triggers (the UHNW signal library, multi-stop, expedition, private jet, party size). This is the fix for the "two surfaces have drifted" problem in master doc v3, and it's where Doctrine 6 lives.

---

## 9. Cruise — handle honestly
Until there's a real-time luxury/expedition cruise feed (TravelWits may not have one; candidates if you later want one: Widgety, Traveltek, or direct line/Cadence cruise tooling):
- Keep cruise as **hybrid**: GPT interprets style/fit, app shows whatever live sailings TravelWits supports, advisor captures everything expedition/polar/complex.
- Do **not** fabricate cruise rates the way hotels are faked today. Use ranges clearly labeled as planning estimates, then route to advisor.
- Keep `VCRUISE` → Virtuoso deep links as the interim booking path.

---

## 10. Phased rollout

| Phase | Goal | Key work | Result |
|---|---|---|---|
| **0** | De-risk | Confirm with TravelWits: REST API vs portal-only? auth model? consortia/preferred rates included? attribution mechanism? cruise coverage? sandbox creds? | You know what you're building against |
| **1** | Hotels live | `api/search.js`, response contract, search UI + results grid in `index.html`, `api/handoff.js`; strip rate fabrication from `prompt.js` | Passive-income hotel engine with **real** rates + booking handoff |
| **2** | Gated value | `api/unlock.js`, lead form, preferred-rate reveal | Compliant VIP-rate unlock + first real lead capture |
| **3** | GPT live anchors | `/api/quote` + GPT Action + instruction tightening | GPT stops hallucinating rates; tighter funnel into app |
| **4** | Cruise + advisor brief | Hybrid cruise flow, structured advisor brief generation + sink | Lane B/C operational, no faked cruise data |
| **5** | Intelligence | Analytics events, CRM sync, lead scoring, behavior re-ranking | The KPI + scoring blueprint becomes real |

---

## 11. Decisions to lock before Phase 1
1. **TravelWits API vs portal-only** (§2) — determines whether you render rates or deep-link to them. *Most important.*
2. **Are TravelWits rates the consortia/preferred rates that carry your perks, or net/public rates?** Confirms the value-prop integrity of §2.
3. **Attribution mechanism** — how does TravelWits credit Brian/Aspen on an API-originated booking? Must be in every `bookingHandoffUrl`.
4. **Cruise scope at launch** — live, partial, or none. Sets the §9 expectation.
5. **Production URL + custom domain** (open in master doc v3) — pick before wiring Actions and handoff URLs.
6. **Lead/CRM sink** — where `/api/unlock` and advisor briefs write to.

---

## 12. Bottom line
Keep the blueprint; it predicted this architecture. The work is not a rethink, it's a *completion*: build the structured search surface the app was always meant to be, point it at TravelWits, and — the one non-negotiable — take rate authorship away from the language model on both surfaces and give it to the backend. Do that and "real-time rates," "same as direct + VIP perks," and "clean booking handoff" stop being three competing promises and become one coherent system.

---

*Sources: TravelWits company site (travelwits.com); internal BeVvip files — `Blueprint.rtf`, `GPT Instructions.rtf`, `api/prompt.js`, `api/chat.js`, `public/index.html`, `BeVvip_Project_Management_Master_Document_v3.md`.*
