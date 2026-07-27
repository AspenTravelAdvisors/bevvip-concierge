# Base Camp — UX audit & prioritized fix list

Audit date: 2026-07-27. Scope: `next-concierge/` as deployed at
bevvip-concierge.vercel.app. Stated goal: **qualified advisor leads first,
self-serve hotel booking second.** Naming and IA are open.

> **Status: implemented 2026-07-27.** Items 1–8, 10–15, 17, 18 shipped, plus
> item 9's *interim* fix (`components/AtlasFrame.tsx`). Two items were
> deliberately deferred and are called out at the end of this file. `STATE.md`
> records what changed; this file remains the record of why. Decisions taken
> during implementation, for the record:
>
> - **Naming:** "The Guide" stays (it names an actor with a job). "Base Camp"
>   and "Living Atlas" were removed from navigation and kept only in prose —
>   they labeled things the visitor was already looking at.
> - **Booking (item 5):** relabeled, *not* rolled back to `portal` mode, since
>   the real-time rates/availability API is close. The dateless case now asks
>   for dates inline rather than inventing a tomorrow-night stay.
> - **Advisor SLA:** every inquiry is answered within 24 hours (confirmed), so
>   the CTA quotes that number instead of "will be in touch".
> - **Analytics:** added in the same pass. Nothing here should have to be
>   argued from taste a second time.

---

## The diagnosis in one paragraph

Base Camp is **three products sharing one URL** — a chat concierge, a Mapbox
globe, and seven separate map applications (six iframed Leaflet apps + one
server-rendered villa browser) — and the code never declares which one is the
main event. The globe is full-bleed, the chat is docked on top of it, the header
offers eight more destinations, and the empty state offers three further ways to
begin (a hotel search form, five canned prompts, a free-text box). Every surface
is styled as primary, so none reads as primary. Layered on top: five brand names
(*Expedition Bucket List*, *Aspen Travel Advisors*, *Base Camp*, *The Guide*,
*Living Atlas*), none of which describes a function, and an auto-opening 7-slide
modal tour that fires 700 ms after load — teaching the chrome before the visitor
has seen any value. Meanwhile the thing the business actually wants — a
traveler's brief in an advisor's inbox — is **four interactions deep** (ask →
results → CTA → form) and **only reachable if a search returned inventory**.

The fix is not more explanation. It is **subtraction plus one declared path.**

---

## P0 — ship first (high impact, low/medium effort)

### 1. The auto-opening tour is the first impression
`components/IntroTour.tsx`

Seven dimming slides open unprompted 700 ms after paint. Worse, `computeVisibleSlides()`
silently drops slides whose target is off-screen, so mobile visitors get a
*different, shorter* tour than desktop — the surface that most needs explaining
gets the least. A tour is a confession that the UI isn't self-evident; running it
before the visitor has seen the product converts curiosity into a dismissal
reflex.

**Fix.** Remove the auto-open (`SEEN_KEY` first-visit branch). Keep the tour,
reachable from an explicit "How this works" link in the header. If you keep any
first-run help, make it one non-modal line anchored to the composer
("Ask in plain English — *somewhere warm in February, two of us*"), not a scrim.

*Effort: S. Risk: none.*

---

### 2. Three unranked ways to start, and the most prominent one is wrong
`components/GuideChat.tsx` (empty state), `components/BookingStrip.tsx`

The empty state stacks: `<h1>` + paragraph + "How The Guide works" toggle +
**BookingStrip** (Where / Check-in / Check-out / adults / children / *See VIP
rates*) + "or explore" + five long chips + the composer. That is a structured
search engine, a canned-prompt gallery and a conversation, competing in 400 px.

The real defect is in the strip. `composeAsk()` **always** produces
`"VIP hotels in {destination}, …"`. A visitor who types *Antarctica* into the
biggest, most search-engine-looking control on the page — flanked by check-in and
check-out dates — gets a **hotel** search for Antarctica. The strip hard-frames a
seven-category concierge as a hotel booking box, and it does so at the exact
moment the visitor is forming their model of the product.

**Fix (leads-first).** Make free text the primary and only opening move. Demote
the strip behind a single line — "Have dates? Add them" — that expands it, and
change its submit to compose a category-neutral ask (`"{destination}, {dates},
{party}"`) so the Guide routes it. Cut the chips from five to three, shorten them
(*Antarctica in January* beats *Galápagos Expedition Cruise journeys in
January*), and drop the "How The Guide works" toggle by writing its content into
the subhead.

*Effort: M. Risk: low — the strip's plain-language contract is preserved.*

---

### 3. There is no always-available advisor path
`components/GuideChat.tsx` — `ChatMoves`, gated on `hasResults`

For a leads-first product this is the headline finding. The advisor CTA renders
**only** on assistant turns that produced cards or a deep link. A visitor who
lands knowing they want a human, or whose first two questions return nothing,
has no route to one. There is no phone number, no "talk to someone", nothing in
the header — the only human-contact affordance in the app is conditional on a
successful inventory search.

**Fix.** Put one persistent CTA in the header (`app/layout.tsx`) — *Talk to an
advisor* — opening the same capture form `ChatMoves` uses. Extract that form into
its own component so the two entry points share it. Also render the in-chat CTA
after any turn where the Guide has emitted a `[[BRIEF:]]` tag, not only where
inventory came back.

*Effort: M. Impact: the highest of anything on this list.*

---

### 4. Four competing next-actions on every result block
`components/ResultCards.tsx`, `components/GuideChat.tsx`

A single hotel answer currently renders:

| Control | Where | What it does |
| --- | --- | --- |
| `Open in Atlas →` | on every card | opens one property in an iframed map |
| `Book VIP rate →` / `Check VIP rates ↗` + *Access code:* note | on every card | leaves the site for TravelWits |
| `Open in the Atlas →` | under the card row | opens the *whole shortlist* in the same map |
| `Prepare My Hotel Shortlist` | under that | the lead form |

Two of them are near-identically worded ("Open in Atlas" vs "Open in the Atlas")
and mean different things. Nothing marks which is intended. In a leads-first
product the ranking should be unambiguous:

1. **Primary** — one consistently-worded advisor CTA.
2. **Secondary** — a single map link, worded by scope ("See all 5 on the map").
3. **Tertiary** — booking, on hotel cards only, worded honestly (below).

Also collapse `GUIDE_CARD_LIMIT_TOTAL = 5` cards + a group CTA into: 3 cards,
then "+ 7 more →".

*Effort: M.*

---

### 5. "Book VIP rate" doesn't book, and the access-code note reads as a wall
`lib/atlas/booking.js`, default `MODE = "deep"`

The module's own header admits it: TravelWits links are a **destination search**,
not a property page. `stayFromTrip()` silently substitutes a **one-night stay
checking in tomorrow** when no dates were captured. So a visitor reading about a
hotel in Kyoto for next spring clicks *Book VIP rate* and lands on a third-party
list of Kyoto hotels priced for tomorrow night — with a note telling them they
need an *access code*. That is a trust break at peak intent, and it contradicts
BOOKING-SPEC §6's own rule ("no up-front book affordance until the link behind it
lands on a rate page").

**Fix, cheapest first.** Relabel to what it is — *Search VIP rates* — and append
the real dates being searched, so the substitution is visible rather than
discovered. Suppress the CTA entirely when no dates are captured (a dateless
visitor is a lead, not a booker — send them to the advisor). Move the access-code
line off the button into the destination page or a tooltip. If per-property IDs
aren't landing soon, flip `NEXT_PUBLIC_BOOKING_MODE=portal` and stop promising a
rate.

*Effort: S. Risk: none — strictly more honest.*

---

### 6. The lead CTA has five different labels and none says what happens
`components/GuideChat.tsx` — `HANDOFF_CTA`

*Prepare My Hotel Shortlist* / *Find My Best Expeditions* / *Compare Antarctica
Options* / *Show My Best Yacht Options* / *Request This Villa Through Your
Advisor* / *Continue With A Specialist* — six grammars, Title Case, and not one
of them says a human will email you. The explanatory hint is 12 px grey text
*beside* the button. Category-tailored copy is a nice instinct, but it is being
spent on the one control that most needs to be memorable and identical
everywhere.

**Fix.** One label, everywhere, plain: **"Send this to an advisor"**, with the
category as the supporting line ("An Aspen specialist will price these four
Antarctica sailings and come back to you — usually within a day"). Give the form
a title and a close affordance (it currently has only *Back*), and show the
visitor the brief being sent — it's their own words, and seeing it is what makes
the form feel worth filling.

*Effort: S.*

---

### 7. The "The Guide" nav tab does two different things
`components/GuideTab.tsx`

On any page it navigates home. **On the home page it silently swallows the click
and opens the tour instead.** Same control, same label, two behaviors, no signal.
A visitor who clicks the tab expecting to get back to the chat gets a modal.

**Fix.** Always navigate. Move the tour to an explicit "How this works" link.

*Effort: XS.*

---

### 8. Two identical "Start over" buttons; no way to stop a reply
`components/GuideChat.tsx`

Once a conversation exists, `↺ Start over` renders in the session bar **and** in
the composer toolbar, simultaneously, same glyph and label. Separately: the
textarea is `disabled={busy}`, so the visitor cannot type their next thought
while a reply streams, and the only way out of a slow answer is *Start over* —
which wipes the whole conversation and the captured trip. The app feels frozen
and the escape hatch is destructive.

**Fix.** Keep the composer one; drop it from the session bar. Leave the textarea
enabled during streaming (queue the send), and add a **Stop** button that calls
the existing `abortRef` without bumping `genRef` or clearing state.

*Effort: S.*

---

## P1 — structural (the "not intuitive" root cause)

### 9. Three different map products in one app
`components/AtlasShell.tsx` (Mapbox globe) · `components/AtlasView.tsx` →
`public/maps/<type>/index.html` (six iframed Leaflet apps) ·
`components/VillaAtlas.tsx` (server-rendered cards + clusters)

The home globe and the seven collection maps share no interaction grammar,
visual language, control placement, or state. Clicking a pin on the home globe
sends you into a *different application* with its own chrome, its own filters,
its own Share button — inside an iframe, so browser back is unreliable and
nothing you did there comes home with you. Villas is a third pattern again. A
visitor who learns one map has learned nothing about the next.

This is the single largest source of the "confusing / not intuitive" report, and
nothing above fully fixes it.

**Fix (target).** One map — the Mapbox globe in `AtlasShell` — with a collection
filter replacing the seven routes. `/atlas/hotel` becomes the same globe with
`type=hotel` preselected. Pin click opens a card **in the rail beside the map**,
not a new app; the "Ask The Guide about this" action stays in place.

**Fix (interim, if the port is too big now).** Keep the iframes, but make the
route wrapper carry a consistent header, a visible "Ask The Guide about this
collection" rail, and a real breadcrumb back — so at least the frame around the
foreign UI is yours.

*Effort: L (target) / M (interim). Highest structural payoff.*

---

### 10. The navigation is a taxonomy nobody thinks in
`components/NavTabs.tsx`

Eight tabs in a horizontally-scrolling row with edge-fade hints: *The Guide ·
Jets · Yachts · Hotels · Villas · Expeditions · World Cruises · Rails*. Problems,
in order of severity:

- **It's ordered by nothing.** Jets (smallest inventory) first; Hotels (2,501
  records) third.
- **It demands the visitor translate intent into your categories.** Someone
  thinking *"somewhere warm in February"* or *"Antarctica"* cannot map that onto
  a vessel type. Category-first navigation serves people who already know the
  answer; your Guide exists precisely because most don't.
- **It scrolls sideways**, so on a phone or a half-width window part of the
  product is literally invisible.
- **`/answers` is not in it** — a real, indexed content surface that links back
  into the app is orphaned from the app's own navigation.

**Fix.** Collapse the seven collections into one **Explore** menu (ordered
Hotels, Villas, Expeditions, World Cruises, Rails, Yachts, Jets — by inventory
and by how often people want them). Header becomes: *Base Camp · Explore ▾ ·
Answers · **Talk to an advisor***. That frees the one header slot that matters
for the lead CTA in P0-3.

*Effort: M.*

---

### 11. Three different answers to "what's in this product?"
`app/page.tsx` (blurb) · `components/AtlasShell.tsx` (`LEGEND` / `legendRows`) ·
`components/NavTabs.tsx`

- The home blurb names **four** collections: hotels, expedition cruises, private
  jets, hotel yachts.
- `NavTabs` lists **seven**.
- The legend defines seven but renders `LEGEND.filter(it => loaded.has(it.key))`
  — **only the layers whose feed finished loading.** Your own screenshot shows
  five: Villas and Rails are missing. The legend therefore describes a different
  product on every page load, depending on network luck.

Villas (3,902 records) and Rails don't exist in the marketing copy at all.

**Fix.** One canonical collection list in `lib/atlas-config.ts`, consumed by
blurb, legend and nav. Render the legend from that list with pending layers
shown dimmed ("loading"), never omitted.

*Effort: S. Cheap credibility win.*

---

### 12. The globe is the biggest element and the least actionable
`components/AtlasShell.tsx`

The map owns the full stage. Its only prominent controls are **Fullscreen /
Style / 2D** — three cosmetic options. There is no search on the map, no "what am
I looking at", and nothing indicating that pins are clickable. The legend's
caption is the instruction **"Tap to hide"** — an instruction used as a heading,
describing one direction of a toggle, on a control most people will read as a
key rather than a filter. Meanwhile the actual affordance (click a pin) is
undocumented outside the tour.

**Fix.** Caption the legend *Collections* and let the toggle state carry the
meaning (`aria-pressed`, struck-through when off). Demote Style/2D into a single
gear. Add the one thing a map needs: a place search that recenters the globe and
seeds the Guide with the same place.

*Effort: M.*

---

### 13. Sessions evaporate
`components/GuideChat.tsx` (`sessionStorage`), `lib/trip-state.ts`

Conversation and trip state both live in `sessionStorage`. Close the tab, come
back tomorrow, and a half-built brief — the most valuable artifact in a
leads-first product — is gone with no trace. Travel research spans days.

**Fix.** Move both to `localStorage` with a timestamp and a "Pick up where you
left off?" resume prompt after ~24 h. (Add an explicit clear; keep *Start over*
as the escape.)

*Effort: S. Direct revenue impact.*

---

## P2 — worth doing, lower leverage

**14. Mobile is a hidden state machine.** `components/HomeSplit.tsx` +
`AtlasDock.tsx`: a three-detent bottom sheet, swipe-up/swipe-down gestures, a
separate floating dock with its own chips, a pill, and a *Map ▾* button. The
handle label literally has to read "— swipe up" because nothing else conveys it.
For a leads-first product, a phone visitor should land in the **conversation**
with the map as a peek, not the reverse. Reduce to two detents; make every state
change reachable by tap.

**15. The desktop resize gutter earns a whole tour slide** for a preference
almost nobody sets. Keep the drag; drop the slide.

**16. Card date/price shapes leak.** `ResultCards.cardDate`/`cardDuration`
juggle `dates | startDate | month | nights | days` and villas render
`price_string` ("Call for Pricing") from a `rate_from_usd: 0` sentinel. Normalize
in `lib/search-offerings.js` so components render one shape.

**17. Accessibility.** Legend buttons change only `title` on toggle (no
`aria-pressed`); several controls are glyph-only (`↺`, `⛶`, `‹`, `✎`); the tour's
spotlight ring isn't focus-trapped; contrast of white chrome over satellite
imagery is unreliable at some zooms.

**18. Mid-stream tag flash.** `stripControlTags` catches a trailing partial
`[[…` but `[[OPTIONS:` / `[[BRIEF:` can render as visible text for a frame while
streaming. Suppress from the first `[[` onward until the closing `]]` arrives.

---

## Suggested sequence

| Wave | Items | Outcome |
| --- | --- | --- |
| **1** (days) | 1, 7, 8, 5, 6, 11 | Stop the bleeding: no modal wall, no lying buttons, no duplicate controls, one honest inventory story. Nothing structural. |
| **2** (1 week) | 3, 4, 2 | The lead path becomes obvious and always available; the opening move becomes singular. This is where conversion moves. |
| **3** (2–3 weeks) | 10, 13, 12, 9-interim | Navigation and memory stop working against the visitor. |
| **4** | 9-target, 14 | One map. One mobile model. The structural cure. |

---

## Deferred — and why

**Item 9, target fix (one map).** Base Camp still runs three map products: the
Mapbox globe, six iframed Leaflet apps, and the server-rendered villa browser.
`AtlasFrame` now wraps all of them in identical chrome — breadcrumb, count, an
"ask about this" box, advisor CTA — so arriving at a collection feels like the
same product. It does not make them *behave* like the same product. Doing that
means porting seven datasets' filters, cards and interactions onto the globe,
which is a project, not a patch. No traffic yet means no redirect risk whenever
it happens, so there is no penalty for sequencing it properly.

**Item 16 (result-shape normalization).** `ResultCards.cardDate` /
`cardDuration` still reconcile `dates | startDate | month | nights | days`
across collections at render time. The right fix is in `lib/search-offerings.js`
— 93 KB, seven datasets, no test coverage. Changing it inside a UX pass risks
silently breaking dates on a collection nobody clicks during review, in exchange
for tidiness the visitor never sees. It should be its own change, with the
output diffed per collection.

## What to watch now that it's instrumented

The funnel is `ask_sent → results_returned → advisor_cta_clicked →
advisor_request_sent`, with `booking_clicked` running parallel. Three specific
questions this pass makes answerable:

1. **Does `ask_sent{source}` skew to `chip` or `composer`?** Heavy chip reliance
   means the empty state still isn't making "say anything" feel allowed, and the
   next move is copy, not layout.
2. **What share of `advisor_cta_clicked` comes from `header` vs. `chat`?** A
   meaningful cold share confirms item 3 — that real demand was being turned
   away by gating the form behind a successful search.
3. **`tour_finished{completed}`.** If almost nobody opens it now that it doesn't
   open itself, delete it. That is a good outcome, not a failure: it means the
   interface stopped needing a narrator.
