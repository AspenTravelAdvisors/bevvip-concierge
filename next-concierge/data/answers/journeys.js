// Answer pages — cross-category: advisors, world cruises, trains, yachts.
// Counts cited were computed from data/atlas/world|train|yacht/itinerary.json
// and the hotel/cruise atlases on the `updated` date.

const UPDATED = "2026-07-21";

export const journeyAnswers = [
  {
    slug: "do-travel-advisors-cost-more",
    category: "Planning",
    question: "Do travel advisors cost more than booking it yourself?",
    title: "Do Travel Advisors Cost More Than Booking Yourself?",
    description:
      "How travel advisors are paid, when they cost nothing extra, when fees apply, and the benefit math at 2,500 luxury hotels — an honest answer to the most-asked question in luxury travel.",
    updated: UPDATED,
    answer: [
      "For luxury hotels, cruises and villas: no — in most cases you pay the same published rate you'd find yourself, the supplier pays the advisor a commission from its marketing budget, and the advisor's programs add benefits on top. At the 2,501 hotels in our Atlas, an advisor booking layers upgrade priority, daily breakfast, and property credits (typically $100+) onto the hotel's own flexible rate — value the DIY booking simply doesn't receive. On expedition cruises and villas the rate parity works the same way.",
      "Where fees do exist, they're for labor, not access: many advisors (ours included) charge planning fees for complex multi-stop itineraries, air-ticketing, or bespoke trip design — disclosed up front, often credited against the trip. The scenario where DIY genuinely wins is narrow: prepaid nonrefundable discount rates, points redemptions, and opaque-channel gambles, all of which trade away flexibility, benefits, or certainty.",
    ],
    sections: [
      {
        h2: "Where the money actually comes from",
        paras: [
          "Luxury suppliers price commission into their published rates whether or not an advisor is involved — book direct and the hotel simply keeps it. This is why rate parity holds: Four Seasons quotes the same flexible rate on its website and through its Preferred Partner advisors; the difference is that the advisor booking arrives flagged VIP with breakfast, credit and upgrade priority attached.",
          "It's also why 'I'll get it cheaper myself' is usually backwards at this tier: the same $1,200 night costs the same either way — one version includes $150 of breakfast and a $100 credit; one doesn't.",
        ],
      },
      {
        h2: "The honest ledger",
        table: {
          columns: ["Scenario", "DIY", "Through an advisor"],
          rows: [
            ["Luxury hotel, flexible rate", "Rate only", "Same rate + breakfast, credit, upgrade priority, VIP flag"],
            ["Expedition cruise", "Brochure fare", "Same fare + advisor amenities/OBC on many sailings, cabin strategy, waitlist leverage"],
            ["Villa", "Listing price, DIY diligence", "Same price, inspected inventory, concierge, contract handled"],
            ["Advance-purchase discount rate", "5–15% cheaper, locked", "Advisor can book it too — but benefits usually don't apply"],
            ["Points redemption", "Wins when value/point is high", "Not an advisor product"],
            ["Complex multi-country itinerary", "Your weekends, your risk", "Planning fee, one accountable throat to choke"],
            ["When things go wrong", "Call-center queue", "A human with the GM's cell number"],
          ],
        },
      },
      {
        h2: "Questions to ask any advisor (including us)",
        list: [
          "Which programs do you hold? (Virtuoso, Four Seasons Preferred Partner, Marriott STARS, Rosewood Elite, etc. — program access is the benefit engine.)",
          "What are your fees, and what do they cover?",
          "Do you charge for hotel-only bookings? (Most don't.)",
          "What happens when a trip breaks — who do I call at 2 a.m.?",
        ],
      },
    ],
    faqs: [
      {
        q: "So when is booking direct actually better?",
        a: "Prepaid discount rates you're certain you'll use, loyalty-point redemptions, and simple domestic trips below the luxury tier where no benefit programs exist. Everywhere else, parity plus perks wins.",
      },
      {
        q: "Do advisors push whatever pays the highest commission?",
        a: "The incentive exists; program economics are fairly flat across luxury brands, which blunts it. The real protection is an advisor whose model is repeat clients — a bad recommendation costs them your next decade, not one commission.",
      },
      {
        q: "What does Base Camp's advisor relationship look like?",
        a: "The Guide (our AI concierge) helps you explore the Atlas — 2,501 hotels, 3,542 expedition sailings, 3,902 villas — and a human advisor takes over for pricing, program benefits, and the booking itself. Ask The Guide anything; it will tell you when a human should take the wheel.",
      },
    ],
    related: [
      { href: "/answers/virtuoso-perks-vs-booking-direct", label: "The Virtuoso benefit stack, itemized" },
      { href: "/answers/four-seasons-preferred-partner-benefits", label: "Four Seasons Preferred Partner, explained" },
      { href: "/", label: "Ask The Guide about your trip" },
    ],
  },

  {
    slug: "world-cruises-compared",
    category: "Voyages",
    question: "World cruises compared: which lines, what they cost, and how far ahead to book?",
    title: "World Cruises Compared — Lines, Costs, and Booking Windows",
    description:
      "The 250 world cruise and grand voyage departures we track across 13 lines — Regent, Silversea, Seabourn, Crystal, Oceania, Viking, Cunard and more — with realistic pricing and the 12–24 month booking reality.",
    updated: UPDATED,
    answer: [
      "Our Voyage Atlas currently tracks 250 world cruises and grand voyages across 13 lines — Oceania, Azamara, Regent, Viking, Crystal, Silversea, Seabourn, Holland America, Princess, Explora, Cunard, Windstar and Lindblad. Full circumnavigations run roughly 110–180 days (the current longest in our data: Oceania Vista's 245-day Epic Global Adventure); most lines also sell them in 15–60 day segments, which is how the majority of guests actually experience them.",
      "Money, honestly: entry-level full world cruises start around $40,000–$60,000 per person (Princess, Holland America, mainstream Cunard cabins); the premium tier (Oceania, Viking, Azamara) runs roughly $60,000–$100,000; and the luxury all-inclusives (Regent, Silversea, Seabourn, Crystal, Explora) begin near $100,000 and climb past $400,000 in top suites. Book 12–24 months out — the best cabins on marquee sailings sell on opening day, with past-guest waitlists ahead of you.",
    ],
    sections: [
      {
        h2: "Which line fits which circumnavigator",
        table: {
          caption: "From the 250 departures in the Base Camp Voyage Atlas, July 2026.",
          columns: ["Tier", "Lines", "Who it's for"],
          rows: [
            ["Luxury all-inclusive", "Regent, Silversea, Seabourn, Crystal, Explora", "Everything-in fares (air, excursions, gratuities on some); suite living for four months"],
            ["Premium", "Oceania, Viking, Azamara", "Food-first (Oceania), culture-first (Viking, no casinos, no kids), port-intensive (Azamara)"],
            ["Classic", "Cunard, Holland America, Princess", "The Cunard crossing-and-ballroom tradition; HAL/Princess value and itinerary breadth"],
            ["Unconventional", "Windstar, Lindblad", "Small-ship and expedition-flavored long voyages rather than classic circumnavigations"],
          ],
        },
      },
      {
        h2: "What veterans know that first-timers don't",
        list: [
          "Segments outsell the full loop for a reason: 30–45 days (a Pacific leg, Cape Town–Sydney) delivers the world-cruise rhythm without the four-month commitment.",
          "The fare is half the spend: overland excursions (Taj Mahal, safari inserts), visas, and the onboard life add 20–40%. All-inclusive lines compress this — part of why their sticker premium shrinks in practice.",
          "Cabin choice is a marriage decision at 140 days — pay for the balcony and the laundry-room proximity joke that stops being a joke.",
          "Opening-day pricing usually is the best pricing (with shipboard-credit sweeteners and past-guest discounts); world cruises rarely fire-sale, they sell out.",
          "January departures dominate — the route follows summer around the planet.",
        ],
      },
    ],
    faqs: [
      {
        q: "What's the single best value in world cruising right now?",
        a: "Premium-tier segments booked early: an Oceania or Viking 30-day leg in a veranda cabin prices near a good hotel holiday of the same length — with thirty ports and one unpack. Full-cruise value peaks at Regent when you actually use the included business-class air and excursions.",
      },
      {
        q: "Can you do a world cruise with kids or while working?",
        a: "Working: increasingly yes (Starlink-era connectivity is real on Viking, Explora, Oceania's newest). Kids: Viking bars under-18s entirely; the luxury lines welcome but don't program for them; a gap-year family fits best on Cunard or HAL.",
      },
      {
        q: "How far ahead should I really book?",
        a: "Marquee luxury sailings: at launch, 18–24 months out, through an advisor with line relationships — allocations and waitlist priority are genuinely relationship-driven. Segments and classic-tier: 12 months is usually fine.",
      },
    ],
    related: [
      { href: "/atlas/worldcruise", label: "Browse all 250 voyages in the Voyage Atlas" },
      { href: "/answers/luxury-vs-classic-expedition-cruising", label: "Prefer landings to sea days? Expedition cruising compared" },
      { href: "/answers/do-travel-advisors-cost-more", label: "Why world cruises are the most advisor-shaped purchase in travel" },
    ],
  },

  {
    slug: "best-luxury-train-journeys",
    category: "Rails",
    question: "What are the best luxury train journeys in the world?",
    title: "The Best Luxury Train Journeys in the World, Ranked",
    description:
      "The great sleeper trains ranked and compared — Venice Simplon-Orient-Express, La Dolce Vita, Belmond's Scotland and Peru trains, Rocky Mountaineer and Asia's classics — from 135 tracked rail journeys.",
    updated: UPDATED,
    answer: [
      "The canon, ranked by how often they reward the fare: the Venice Simplon-Orient-Express (Belmond) remains the definitive one-night masterpiece — Paris/London to Venice in 1920s carriages, the single best first luxury train; La Dolce Vita Orient Express is the new Italian counterpoint, running Rome-based loops in midcentury-modern style; Belmond's Royal Scotsman (Highlands, whisky, 40 guests) and Andean Explorer (Cusco–Titicaca–Arequipa, the highest luxury sleeper on earth) own their landscapes; and Rocky Mountaineer (daylight-only, hotel nights) is the right answer for the Canadian Rockies and travelers who want scenery without sleeping on rails.",
      "Our Rail Atlas tracks 135 luxury rail journeys and rail-centered itineraries worldwide — including Japan by rail (where the ultra-exclusive Seven Stars and Shiki-shima run by ballot), the Alps by Glacier Express Excellence Class, and multi-country itineraries that thread trains into a larger trip, which is how we most often deploy them.",
    ],
    sections: [
      {
        h2: "The shortlist, honestly differentiated",
        table: {
          columns: ["Train", "Route", "Nights", "The verdict"],
          rows: [
            ["Venice Simplon-Orient-Express", "Paris/London–Venice (+ seasonal routes)", "1–2", "The icon; book Grand Suites for the bathtub-on-rails flex, historic cabins for the romance"],
            ["La Dolce Vita Orient Express", "Rome loops: Tuscany, Sicily, the south", "1–2", "New-school Italian glamour; food and design forward"],
            ["Royal Scotsman", "Edinburgh Highlands circuits", "2–7", "House-party-in-tweed; 40 guests, whisky ambassador aboard"],
            ["Andean Explorer", "Cusco–Puno–Arequipa", "1–2", "Altiplano scenery no road matches; pairs with Machu Picchu's Hiram Bingham day train"],
            ["Rocky Mountaineer", "Vancouver–Banff/Jasper", "2 days (hotels at night)", "GoldLeaf dome + hotel beds; the pragmatist's great train"],
            ["Eastern & Oriental Express", "Singapore–Malaysia", "2–3", "Teak, orchids and jungle; Southeast Asia's only true luxury sleeper"],
            ["Glacier Express Excellence Class", "Zermatt–St. Moritz", "Day journey", "Eight hours, seven courses, one guaranteed window seat"],
          ],
        },
      },
      {
        h2: "What luxury trains are actually for",
        paras: [
          "They're not transportation — they're a destination that moves at 60 km/h. The correct uses: a milestone celebrated in one extraordinary night (VSOE), a landscape best consumed from a window with a drink (Scotland, the Andes, the Rockies), or the connective set-piece inside a bigger itinerary — Cusco to the lake, Singapore to Malaysia — where the train replaces a flight you'd forget with a day you won't.",
          "Cabin honesty: historic carriages mean compact cabins and, on some trains, shared-era plumbing quirks; the new-build suites (Dolce Vita, VSOE's newest Grand Suites) are the answer for travelers who want the romance with modern bathrooms. Price ranges from roughly $1,500 per person for the Glacier Express day to $5,000–$15,000+ per cabin-night at the top of the VSOE and Japanese trains.",
        ],
      },
    ],
    faqs: [
      {
        q: "Which train first?",
        a: "VSOE Paris–Venice for couples and celebrations; Rocky Mountaineer for families and view-maximalists; Royal Scotsman if the ideal vacation is a country-house weekend that happens to move.",
      },
      {
        q: "Are the Japanese luxury trains bookable?",
        a: "Seven Stars in Kyushu and Train Suite Shiki-shima sell by lottery/ballot months ahead with tiny capacity. They're bucket-list-lightning; we build the Japan trip around the ballot and hold superb rail-adjacent alternatives for when the ballot says no.",
      },
      {
        q: "Train + expedition in one trip?",
        a: "The classic pairings: Andean Explorer + Galápagos; Rocky Mountaineer + Alaska cruise; VSOE into a Mediterranean sailing. Rails to the dock is the itinerary trick that makes both halves feel intentional.",
      },
    ],
    related: [
      { href: "/atlas/train", label: "All 135 rail journeys in the Rail Atlas" },
      { href: "/answers/world-cruises-compared", label: "The sea-going equivalent: world cruises compared" },
    ],
  },

  {
    slug: "yacht-charter-vs-luxury-yacht-cruise",
    category: "Yachts",
    question: "When should you charter a yacht vs. book a luxury yacht cruise?",
    title: "Yacht Charter vs. Luxury Yacht Cruise (Four Seasons, Ritz-Carlton, Aman)",
    description:
      "Private crewed charter vs. the new hotel-brand yachts — Four Seasons Yachts, Ritz-Carlton Yacht Collection, Aman at sea, Orient Express Corinthian — costs, control and which fits your group.",
    updated: UPDATED,
    answer: [
      "Book the yacht cruise when you want yacht life without yacht responsibility: the hotel-brand fleet — Ritz-Carlton Yacht Collection, Four Seasons Yachts, Orient Express's Corinthian, and Aman's forthcoming Amanclipper era — sells suite-level cabins from roughly $1,500–$4,000 per night for two, with restaurants, spas, marinas off the stern and zero decisions required. Our Yacht Atlas tracks 374 sailings across these four brands. Charter privately when the group is the point: a crewed 6-cabin yacht for 8–12 guests runs about $150,000–$400,000+ per week plus roughly 30–35% for fuel, food, dockage and gratuity (the APA) — which per-person, per-night lands surprisingly close to two top suites on a brand yacht, except the itinerary, the chef and the guest list answer to you.",
      "Rule of thumb: fewer than 6 people or a first taste of yacht travel → the brand yachts. Eight-plus people, a milestone, or strong opinions about anchorages → charter.",
    ],
    sections: [
      {
        h2: "Side by side",
        table: {
          columns: ["", "Hotel-brand yacht cruise", "Private crewed charter"],
          rows: [
            ["You control the route", "No — published itineraries", "Yes, within weather and the captain's judgment"],
            ["Cost shape", "Per suite: ~$1,500–4,000/night for two", "Whole boat: ~$150k–400k+/week + ~30–35% APA"],
            ["Best group size", "Couples, 2–6 travelers", "8–12 (six-cabin sweet spot)"],
            ["Food", "Multiple restaurants", "One chef cooking your preferences exactly"],
            ["Privacy", "Ship-sized: intimate but shared", "Total"],
            ["Effort to plan", "None — it's a cruise", "Real: boat selection, itinerary, provisioning preferences"],
            ["Kids/teens", "Good on Ritz-Carlton; varies", "Perfect — the boat becomes theirs"],
          ],
        },
      },
      {
        h2: "What the hotel-brand yachts actually are",
        paras: [
          "The Ritz-Carlton trio (Evrima, Ilma, Luminara) invented the category: 149–226 suites, all-balcony, no buffet-ship energy, Med and Caribbean seasons. Four Seasons Yachts arrives at the top of the market with 95 suites and residential layouts. Orient Express's Corinthian is the sail-flex — the world's largest sailing yacht silhouette with 54 suites. These are yachts in scale and marina access but cruises in operation: fixed departures, published ports, superb food, and the brand's service culture afloat. For most travelers they're the gateway drug; charter is what happens the second year.",
          "Charter's open secret is the APA — the Advance Provisioning Allowance (~30% of the base rate) that funds fuel, food, wine and dockage at cost. Budget it from the start; the brochure rate is not the trip cost.",
        ],
      },
    ],
    faqs: [
      {
        q: "What does a week really cost, all-in, for 10 people on charter?",
        a: "A quality 50-meter at $250,000 base + 30% APA + 15% crew gratuity ≈ $360,000 — $5,100 per person per night. Two Grand Suites for the same couple-count on a brand yacht runs $3,000–4,000/night per couple. Closer than yacht mythology suggests — the premium buys control, not just space.",
      },
      {
        q: "Med or Caribbean, and when?",
        a: "Med June–September (book winter for August), Caribbean December–April (book by early fall for festive weeks). The brand yachts reposition seasonally exactly like charter fleets — our Atlas shows both seasons' sailings.",
      },
      {
        q: "Are the brand yachts good for non-cruise people?",
        a: "They're specifically engineered for cruise-skeptics: no announcements, no lido-deck contests, marinas that open from the stern, port-intensive itineraries. If the objection is 'I don't do cruises,' this is the counter-argument in steel.",
      },
    ],
    related: [
      { href: "/atlas/yacht", label: "All 374 brand-yacht sailings in the Yacht Atlas" },
      { href: "/answers/world-cruises-compared", label: "Longer at sea: world cruises compared" },
      { href: "/answers/best-caribbean-villas-for-12-guests", label: "The land-based alternative for big groups" },
    ],
  },
];
