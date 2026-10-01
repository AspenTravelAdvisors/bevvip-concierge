// Answer pages — luxury hotels.
//
// Counts in this copy are NOT typed. `{{hotels:program=Marriott STARS}}` is a
// query against data/atlas/hotel/luxury-hotels.json, resolved when the page
// renders (lib/seo/facts.mjs; the vocabulary of terms is documented there).
//
// They used to be typed, with a note above them explaining that they were "a
// dated snapshot rather than a live figure". By the time the Virtuoso sync had
// been running a month the snapshot had drifted badly enough to be worth
// listing: STARS 103 -> 59, Bellini Club 22 -> 3, Mandarin Oriental Fan Club
// 34 -> 4, Virtuoso 1,970 -> 1,866, and — the one that matters most, because
// the classifier had been wrong rather than the supplier — 15 ski properties
// where the feed flags 94. Every one of those sentences was published, indexed
// and citable. A page that exists to be quoted cannot carry numbers that go
// stale in silence, so these do not.
//
// `capsule` is the extractable answer: 40-60 words, no preamble, true on its
// own out of context, because that is the unit an answer engine lifts.
// `evidence` is a query whose results the page renders as a table of real,
// linked properties — the atlas standing behind the claim.

const UPDATED = "2026-07-21";

export const hotelAnswers = [
  {
    slug: "four-seasons-preferred-partner-benefits",
    category: "Hotels",
    question: "What do you actually get booking Four Seasons through a Preferred Partner?",
    title: "Four Seasons Preferred Partner Benefits, Explained",
    description:
      "Is booking Four Seasons through a Preferred Partner advisor worth it? Yes: the 2026 benefits list — breakfast, a $100 or $200 credit, an upgrade, early and late check-out — at the same rate as booking direct, across the {{hotels:program=Four Seasons Preferred Partner}} Preferred Partner properties in our atlas.",
    updated: "2026-10-01",
    capsule:
      "Yes, it is worth it: booking Four Seasons through a Preferred Partner advisor costs the same as the hotel's own rate and, in 2026, adds daily breakfast for two, a $100 property credit per stay ($200 in suites), an upgrade at check-in when available, priority early check-in and late check-out, and a VIP flag on the reservation. On a five-night resort stay that is typically $700–$1,500 of value.",
    answer: [
      "Yes. Booking Four Seasons through a Preferred Partner advisor gets you, at no extra cost over the hotel's own rate: an upgrade at check-in when available (with Preferred Partner reservations prioritized for them), daily breakfast for two, a property credit of $100 per stay in guest rooms and $200 in suites, early check-in and late check-out priority, and — the part regulars value most — your reservation flagged in the hotel's system as a Preferred Partner VIP before you land.",
      "The rate itself is the same as booking direct. Four Seasons runs Preferred Partner as its official top-tier advisor program precisely so the benefits ride on top of published rates rather than discounting them. Our atlas currently tracks {{hotels:program=Four Seasons Preferred Partner}} Four Seasons Preferred Partner properties, out of {{hotels:name=four seasons}} Four Seasons hotels in it overall.",
    ],
    sections: [
      {
        h2: "2026 Preferred Partner benefits",
        paras: [
          "The standard Four Seasons Preferred Partner benefits for stays in 2026, as Four Seasons publishes them to member advisors. Checked 2026-10-01. Individual hotels sometimes add to the list, such as a spa credit or airport transfers, and each property's own page in our atlas shows what is on file for it.",
        ],
        list: [
          "Daily breakfast for two guests per bedroom, in the restaurant or through in-room dining at most hotels. A few city hotels give a per-person breakfast credit instead.",
          "A property credit once per stay: $100 in guest rooms, $200 in suites, specialty suites and villas. It is used for dining or spa and has no cash value.",
          "An upgrade of one category at check-in, when available. Preferred Partner reservations are near the front of the queue, but it is not guaranteed.",
          "Early check-in and late check-out, when available, with priority over ordinary bookings.",
          "Complimentary Wi-Fi.",
          "The reservation flagged to the hotel as a Preferred Partner booking, with the advisor's name attached.",
        ],
      },
      {
        h2: "The benefit stack, item by item",
        table: {
          columns: ["Benefit", "What it's actually worth"],
          rows: [
            ["Room upgrade (subject to availability, prioritized)", "One category at busy resorts; sometimes more midweek in cities — routinely $200–$800/night of value"],
            ["Daily breakfast for two", "$80–$150/day at resort pricing"],
            ["Property credit ($100 per stay; $200 in suites)", "Face value, usable at spa or F&B"],
            ["Early check-in / late check-out priority", "Occasionally the whole ballgame on arrival/departure days"],
            ["Welcome amenity + VIP flag", "Soft value: the GM knows you're coming and whose guest you are"],
          ],
        },
        paras: [
          "Over a five-night resort stay, the countable benefits alone typically return $700–$1,500 — on a booking that costs you exactly what the Four Seasons website quoted.",
        ],
      },
      {
        h2: "Preferred Partner vs. Amex FHR vs. booking direct",
        paras: [
          "Amex Fine Hotels + Resorts offers a similar-looking stack, and at Four Seasons both are legitimate. The differences: FHR benefits are standardized and transactional; Preferred Partner adds the advisor's relationship — pre-arrival notes to the GM, intervention when things go sideways, and access when the hotel is 'sold out.' Booking direct with no program gets you none of the stack. Prepaid advance-purchase rates are no longer the exception they once were: many now carry the Preferred Partner benefits too, so an advisor can book the cheaper prepaid rate with the benefits where a hotel allows it. Ask for both rates side by side.",
        ],
      },
      {
        h2: "How to use it well",
        list: [
          "Book the room category you'd be happy to sleep in — upgrades are when-available, not guaranteed.",
          "Tell your advisor what the trip is for; 'anniversary' in the pre-arrival note outperforms any status.",
          "Stack with Four Seasons' own offers (third night free, etc.) — Preferred Partner benefits apply on most published promotions.",
          "Booking a suite doubles the credit to $200, which narrows the gap to the room below more than the rate difference suggests.",
          "Use it hardest at resorts, where breakfast and credits price highest.",
        ],
      },
    ],
    evidence: {
      h2: "The Preferred Partner properties, from the supplier feed",
      note:
        "Every Four Seasons in the atlas filed under Preferred Partner, largest first. Each links to the property's own page, where the benefits currently on file for it are listed in full.",
      query: "program=Four Seasons Preferred Partner",
      sort: "rooms",
      limit: 15,
    },
    faqs: [
      {
        q: "Does Preferred Partner cost more than the Four Seasons website?",
        a: "No. Rates match the hotel's own flexible published rate; the benefits are additive. If you ever see a lower flexible rate direct, your advisor books that rate — the benefits still apply.",
      },
      {
        q: "Are upgrades guaranteed?",
        a: "No — they're subject to availability at check-in, but Preferred Partner reservations sit atop the upgrade queue alongside FHR. Midweek city stays and shoulder-season resorts clear most often.",
      },
      {
        q: "How is this different from Virtuoso at Four Seasons?",
        a: "Preferred Partner is Four Seasons' own top advisor tier and its benefits at FS hotels are the stronger, more consistent stack. Many advisors (including ours) hold both; the booking goes through whichever program serves you better at that property.",
      },
    ],
    related: [
      { href: "/answers/virtuoso-perks-vs-booking-direct", label: "Virtuoso perks vs. booking direct — the general case" },
      { href: "/answers/which-four-seasons-have-swimmable-beaches", label: "Which Four Seasons have swimmable beaches?" },
      { href: "/hotels", label: "Every Four Seasons in the hotel atlas, one page each" },
    ],
  },

  {
    slug: "virtuoso-perks-vs-booking-direct",
    category: "Hotels",
    question: "Virtuoso perks vs. booking direct: what's actually worth it?",
    title: "Virtuoso Perks vs. Booking Direct — What's Actually Worth It",
    description:
      "A plain-English audit of Virtuoso benefits — upgrades, breakfast, $100 credits, VIP status — versus booking hotels direct or through points, with the 2026 amenities on file at real properties, across {{hotels:program=Virtuoso}} Virtuoso properties.",
    updated: "2026-10-01",
    capsule:
      "A Virtuoso booking costs the same as the hotel's best flexible rate and adds an upgrade when available, daily breakfast for two, a property credit of about $100, early check-in and late check-out priority, and a VIP flag — $150–$400 a night of countable value. Booking direct wins only on prepaid discount rates or points redemptions.",
    answer: [
      "At the {{hotels:program=Virtuoso}} Virtuoso properties in our atlas, a Virtuoso booking adds — on top of the hotel's own best flexible rate — a room upgrade when available, daily breakfast for two, a property credit (typically $100), early check-in/late check-out priority, and a VIP flag on your reservation. On a typical luxury stay that's $150–$400 per night of countable value at zero rate premium, which is why the honest answer to 'is it worth it' is: it's free money unless you specifically need a prepaid discount rate or are burning points.",
      "Booking direct wins in exactly two cases: non-refundable advance-purchase rates where the discount exceeds the benefit stack (do the math — breakfast for two at a resort is often $120), and loyalty-program stays where elite status plus points redemption beats cash entirely.",
    ],
    sections: [
      {
        h2: "The comparison, honestly",
        table: {
          columns: ["", "Virtuoso via advisor", "Hotel website (flexible)", "Hotel website (prepaid)", "Points/loyalty"],
          rows: [
            ["Rate", "Same as flexible direct", "Baseline", "5–15% below", "Points"],
            ["Upgrade priority", "Yes", "Status-dependent", "Rarely", "Status-dependent"],
            ["Breakfast for two", "Yes", "No (unless status)", "No", "Elite tiers only"],
            ["$100-ish credit", "Yes", "No", "No", "No"],
            ["Cancellation", "Flexible", "Flexible", "Locked", "Varies"],
            ["A human who knows the GM", "Yes", "No", "No", "No"],
          ],
        },
      },
      {
        h2: "What the amenities look like at real hotels",
        table: {
          caption: "The 2026 Virtuoso amenities on file for each property in the supplier feed, checked 2026-10-01. Upgrades and early or late check-out are always subject to availability. Each property's page in our atlas lists its current terms in full.",
          columns: ["Property", "Breakfast", "Credit, once per stay", "Upgrade", "Early / late", "Anything extra"],
          rows: [
            ["Claridge's, London", "Full breakfast for two, restaurant or in-room", "$100 hotel credit", "On arrival", "Yes", "—"],
            ["Aman Kyoto", "Breakfast for two (already in Aman's rate)", "$100 resort credit", "On arrival", "Yes", "—"],
            ["Casa Cipriani New York", "$45 per person daily breakfast credit", "$100 food and beverage credit", "On arrival", "Yes", "—"],
            ["Capella Kyoto", "Full breakfast for two, restaurant or in-room", "$100; $200 in Junior Suites and above", "On arrival", "Yes", "A further $200 credit on stays of 7+ nights"],
            ["Cheval Blanc Randheli, Maldives", "Breakfast for two (already in the rate)", "$150 food and beverage credit", "On arrival", "Yes", "—"],
            ["Cheval Blanc Paris", "Full breakfast for two, restaurant or in-room", "None", "On arrival", "Yes", "Round-trip private airport or train transfers with meet and greet"],
            ["Amanyara, Turks and Caicos", "Breakfast for two (already in the rate)", "$100; plus $100 per villa bedroom", "On arrival", "Yes", "—"],
            ["Chileno Bay, Auberge Collection, Los Cabos", "$45 per person daily breakfast credit", "$100; $250 in villas of 2+ bedrooms", "On arrival", "Yes", "—"],
          ],
        },
        paras: [
          "Two patterns are worth knowing. Where breakfast is already in a resort's rate, as at most Amans and Maldives islands, the credit and the upgrade are the benefits that count. And several hotels scale the credit with the booking, so a suite or a long stay can be worth two or three times the headline $100.",
          "At hotels that belong to a big group, the group's own advisor program can carry a different list. Our brand-by-brand comparison of those programs is in the link below.",
        ],
      },
      {
        h2: "What the brochures undersell",
        paras: [
          "The soft benefit is the durable one: a Virtuoso reservation arrives at the hotel flagged with your advisor's name and agency relationship. Rooms are assigned before you land, and when a stay goes wrong, the fix comes from the GM's office rather than a call center queue. None of that appears in a rate comparison; all of it appears in how the stay actually goes.",
          "Also underrated: brand sub-programs stacked by good advisors. Our atlas tracks Marriott STARS ({{hotels:program=Marriott STARS}} properties), Four Seasons Preferred Partner ({{hotels:program=Four Seasons Preferred Partner}}), Rosewood Elite ({{hotels:program=Rosewood Elite}}), Shangri-La The Luxury Circle ({{hotels:program=Shangri-La The Luxury Circle}}), Hilton for Luxury ({{hotels:program=Hilton for Luxury}}), The Peninsula Pen Club ({{hotels:program=The Peninsula Pen Club}}), Jumeirah Passport to Luxury ({{hotels:program=Jumeirah Passport to Luxury}}) and others — at those hotels, the brand's own advisor program often out-benefits generic Virtuoso, and the booking should go through whichever is stronger.",
          "One thing the comparison tables never show, because it changes weekly: {{hotels:promo=true}} of the properties in the atlas are carrying a live supplier promotion right now — a resort credit, a fourth night, a wellness package — on top of the benefits above. Those are what an advisor is actually checking when they say they will \"look at both paths.\"",
        ],
      },
    ],
    faqs: [
      {
        q: "Is there any fee to book through a Virtuoso advisor?",
        a: "For hotel bookings, typically none — hotels pay the agency a commission on the same rate you'd have paid anyway. Some advisors charge planning fees for complex itineraries; a straightforward hotel booking shouldn't carry one.",
      },
      {
        q: "Do Virtuoso benefits combine with hotel promotions?",
        a: "Usually yes with published flexible offers (third/fourth-night-free and similar); usually no with opaque or prepaid discounts. Your advisor prices both paths in about five minutes.",
      },
      {
        q: "What if I have elite status with the brand?",
        a: "Stack them. Status benefits (points, lounge, guaranteed late checkout) and Virtuoso benefits (breakfast, credit, upgrade priority) generally coexist on the same stay — the reservation just needs to carry your loyalty number.",
      },
    ],
    evidence: {
      h2: "Properties carrying a supplier offer on top of their VIP benefits",
      note:
        "Live from the Virtuoso promotions feed, refreshed nightly: properties where a current offer stacks on the benefits already on file. The number moves; the table is rebuilt on every deploy.",
      query: "perks=true&promo=true",
      sort: "perks",
      limit: 15,
    },
    related: [
      { href: "/answers/four-seasons-preferred-partner-benefits", label: "The Four Seasons–specific version" },
      { href: "/answers/hotel-brand-advisor-programs-compared", label: "Hotels with advisor perks, brand by brand: STARS, Destined, Hilton for Luxury and more" },
      { href: "/answers/do-travel-advisors-cost-more", label: "Do travel advisors cost more than booking yourself?" },
      { href: "/hotels", label: "Browse all {{collection:hotel}} properties, one page each" },
    ],
  },

  {
    slug: "which-four-seasons-have-swimmable-beaches",
    category: "Hotels",
    question: "Which Four Seasons have swimmable beaches?",
    title: "Which Four Seasons Resorts Have Swimmable Beaches",
    description:
      "The Four Seasons resorts where you can genuinely swim off the beach — Caribbean, Hawaii, Mexico, Asia — and the famous ones where you can't, with honest surf and seasonality notes.",
    updated: UPDATED,
    capsule:
      "The Four Seasons with genuinely swimmable beaches include Nevis, Anguilla, Ocean Club Bahamas, Punta Mita, Costa Palmas Los Cabos, Papagayo, Ko Olina, Wailea, Bora Bora, both Maldives resorts, Jimbaran Bay, Koh Samui, Langkawi, Seychelles and Anahita. Hualalai, Lanai and Tamarindo are beachfront but not reliably swimmable.",
    answer: [
      "The Four Seasons with genuinely swimmable, walk-in-off-the-sand beaches are: Nevis, Anguilla, the Ocean Club Bahamas, Punta Mita (bay beaches), Costa Palmas Los Cabos (the rare swimmable Cabo beach — most of Cabo's coast is not), Peninsula Papagayo, Oahu at Ko Olina (protected lagoons), Maui at Wailea, Bora Bora, Bali at Jimbaran Bay, The Nam Hai Hoi An (seasonal), Koh Samui, Langkawi, Desroches Island and Mahé in the Seychelles, Mauritius at Anahita, and both Maldives resorts (Kuda Huraa and Landaa Giraavaru).",
      "The famous caveats: Hualalai's shoreline is lava-rock dramatic — swimming happens in the spectacular spring-fed King's Pond and pools rather than open surf; Lanai's Hulopoe Bay is swimmable much of the year but winter swells close it; Tamarindo is a surf-and-scenery coast, not a swimming one. If daily ocean swimming is the point of the trip, say exactly that — 'beachfront' and 'swimmable' are different promises.",
    ],
    sections: [
      {
        h2: "By region, with honest notes",
        table: {
          caption: "Compiled from our resort files and advisor stay notes, July 2026. Surf conditions are seasonal — confirm for your travel dates.",
          columns: ["Resort", "Swim verdict"],
          rows: [
            ["Nevis", "Yes — calm Caribbean sand, gentle entry"],
            ["Anguilla", "Yes — Barnes Bay; among the best swim beaches in the portfolio"],
            ["Ocean Club, Bahamas", "Yes — long, calm, classic"],
            ["Punta Mita, Mexico", "Yes — protected bay; some rock, water shoes help at low tide"],
            ["Los Cabos at Costa Palmas", "Yes — Sea of Cortez side, genuinely swimmable (rare for Cabo)"],
            ["Peninsula Papagayo, Costa Rica", "Yes — calm gulf beach"],
            ["Oahu at Ko Olina", "Yes — man-made protected lagoons, ideal for kids"],
            ["Maui at Wailea", "Yes — Wailea Beach; winter swells occasionally spirited"],
            ["Hualalai, Big Island", "Mostly no in the open ocean — swim King's Pond and pools instead"],
            ["Lanai", "Seasonal — Hulopoe Bay superb in calm months, winter surf advisories"],
            ["Bora Bora", "Yes — lagoon swimming, effectively a pool the size of a sea"],
            ["Maldives (both resorts)", "Yes — lagoon perfection"],
            ["Bali at Jimbaran Bay", "Yes — calm bay, best in dry season"],
            ["The Nam Hai, Hoi An", "Seasonal — lovely May–September; NE monsoon churns Oct–March"],
            ["Koh Samui", "Yes — with seasonal variation"],
            ["Langkawi", "Yes — sheltered Andaman beach"],
            ["Seychelles (Mahé, Desroches)", "Yes — Petite Anse is postcard swimming; some seasonal seaweed/wind sides"],
            ["Mauritius at Anahita", "Lagoon swimming yes; ocean-side better for kitesurfers"],
            ["Tamarindo, Mexico", "No for swim-focused trips — surf coast, pools compensate"],
          ],
        },
      },
      {
        h2: "How to choose among the 'yes' list",
        paras: [
          "For small children: Ko Olina's lagoons, Nevis, and the Maldives lagoons are the safest entries. For snorkeling from the sand: the Maldives, Bora Bora and Desroches. For a beach with a scene: Anguilla and Wailea. For swim-plus-surf households where both camps must win: Punta Mita, which has gentle bay beaches and a famous break within the resort's reach.",
          "All {{hotels:name=four seasons}} Four Seasons in our atlas — including all of the above — book with advisor benefits: upgrade priority, breakfast, resort credit. The beach is free either way; the breakfast shouldn't be.",
        ],
      },
    ],
    faqs: [
      {
        q: "Which Four Seasons has the single best beach?",
        a: "For pure swimming: Anguilla or the Maldives. For beauty photographed from a chaise: Bora Bora's lagoon. For a family vote that ends arguments: Ko Olina.",
      },
      {
        q: "Is the Hualalai beach really not swimmable?",
        a: "Its coastline is mostly lava rock and open Pacific; there's a small sandy cove but conditions vary, and the resort's answer is King's Pond — a 1.8-million-gallon spring-fed aquarium you swim in with the rays. Nobody leaves feeling cheated; just arrive with correct expectations.",
      },
      {
        q: "What about Four Seasons resorts on this list in hurricane season?",
        a: "Caribbean and Mexico resorts run superb summer value with real storm risk June–November; the Maldives, Seychelles and Southeast Asia run on different monsoon calendars. This is precisely the itinerary-timing question your advisor exists to solve.",
      },
    ],
    evidence: {
      h2: "The beach-flagged Four Seasons in the atlas",
      note:
        "Properties the supplier itself files under the Beach experience — which is a narrower and more reliable claim than \"beachfront\", and is why the swim verdicts above sit in a separate, hand-kept table.",
      query: "name=four seasons&experience=Beach",
      sort: "name",
      limit: 20,
    },
    related: [
      { href: "/answers/four-seasons-preferred-partner-benefits", label: "What Preferred Partner booking adds at these resorts" },
      { href: "/atlas/hotel", label: "See all Four Seasons on the atlas map" },
    ],
  },

  {
    slug: "best-aman-for-first-timers",
    category: "Hotels",
    question: "Which Aman is best for first-timers (and which should you skip)?",
    title: "The Best Aman for First-Timers — and Which to Skip",
    description:
      "Choosing a first Aman from the {{hotels:name=aman}} Amans in our atlas: Amangiri, Amanpuri, Amanzoe, Amankila and others compared, with honest guidance on where the Aman formula lands best.",
    updated: UPDATED,
    capsule:
      "For a first Aman, choose one where the landscape does the work: Amangiri in Utah, Amanzoe in Greece, Amankila in east Bali, or Amanpuri in Phuket. Leave the city Amans (Tokyo, New York, Venice) and the remote camps for a second visit — they reward travelers who already trust the formula.",
    answer: [
      "For a first Aman, book the one where the setting does the heavy lifting: Amangiri (Utah desert theater, the most photographed Aman on earth), Amanzoe (Greek hilltop temple, beach club below), Amankila (Bali's east-coast original with the three-tier pool), or Amanpuri (the 1988 founding resort in Phuket, still the purest expression of the formula). Each delivers the Aman thesis — monastic architecture, staff ratios that feel telepathic, silence as the luxury — without asking you to already be a convert.",
      "Skip on a first pass: the city Amans (Tokyo, New York, Venice — magnificent, but they demonstrate the brand's restraint without its landscapes, and at the highest nightly rates in the portfolio), and the remotest lodges (Amanwana's tented island, Aman-i-Khas's wilderness camp) which reward you more once you already trust the brand. Our atlas carries {{hotels:name=aman}} Aman properties, all with advisor VIP benefits.",
    ],
    sections: [
      {
        h2: "First-timer shortlist, by trip shape",
        table: {
          columns: ["You want", "Book", "Why"],
          rows: [
            ["The iconic one", "Amangiri, Utah", "Desert amphitheater; combine with Camp Sarika tents; easy US access via Page or Vegas+drive"],
            ["Europe, sea, ruins", "Amanzoe, Greece", "Peloponnese hilltop, private beach club, day trips to Epidaurus/Hydra"],
            ["Asia classic", "Amanpuri, Thailand", "The original; black-tiled pool, Andaman beach, the service benchmark"],
            ["Bali without the crowds", "Amankila (or Amandari for the valley)", "East Bali serenity; the anti-Canggu"],
            ["Wellness immersion", "Amanemu, Japan", "Onsen ryokan reimagined; pairs with Kyoto (Aman Kyoto) rail journey"],
            ["Island castaway", "Amanpulo, Philippines", "Private island, private plane from Manila; the hardest to leave"],
          ],
        },
      },
      {
        h2: "Understand the formula before you pay for it",
        paras: [
          "Aman sells subtraction: few rooms (often 30–50), no lobby bustle, architecture that frames one landscape obsessively, and pricing that starts roughly $1,800–$2,500 a night at the resorts and climbs steeply. What it deliberately doesn't sell: nightlife, scene, kids' clubs at most locations, or anything that requires the word 'vibrant.' Travelers who need stimulation per dollar are happier at Rosewood or One&Only; travelers who exhale at the phrase 'nothing happens here' are home.",
          "Booking through an advisor adds upgrade priority, breakfast, and a property credit at Aman's published rates — and at these prices, the credit and upgrade are not rounding errors.",
        ],
      },
    ],
    evidence: {
      h2: "The Amans in the atlas, smallest first",
      note:
        "Room count is the fastest read on which Aman you are actually booking: the formula scales down, not up, and the properties under 40 keys are where it is most itself.",
      query: "name=aman",
      sort: "smallest",
      limit: 15,
    },
    faqs: [
      {
        q: "Which Aman is the least expensive way in?",
        a: "Rates move seasonally, but the Southeast Asian resorts (Amandari, Amankila, Amanjiwo) in green season are typically the gentlest entry, often 30–40% below the marquee properties. Amangiri and the city Amans anchor the top.",
      },
      {
        q: "Are Amans good for children?",
        a: "Several genuinely are — Amanpulo, Amanzoe (villas with pools), Amangiri's Camp Sarika — but the brand's soul is quiet. If the kids need programming, this isn't the portfolio; if they read books, it's ideal.",
      },
      {
        q: "Aman vs. Six Senses vs. Rosewood — quickly?",
        a: "Aman: silence and architecture. Six Senses: wellness and sustainability with more playfulness. Rosewood: residential glamour and better food scenes. All three sit in our atlas with VIP terms; the right one depends on whether the trip is a retreat, a reset, or a stage.",
      },
    ],
    related: [
      { href: "/answers/virtuoso-perks-vs-booking-direct", label: "What advisor booking adds at Aman rates" },
      { href: "/answers/quietest-luxury-resorts-italy", label: "Quietest luxury resorts in Italy (fellow silence-seekers)" },
      { href: "/hotels", label: "Every Aman in the hotel atlas, one page each" },
    ],
  },

  {
    slug: "ritz-carlton-vs-four-seasons-vs-rosewood",
    category: "Hotels",
    question: "Ritz-Carlton vs. Four Seasons vs. Rosewood: how do the big luxury brands actually differ?",
    title: "Ritz-Carlton vs. Four Seasons vs. Rosewood, Honestly Compared",
    description:
      "An advisor's field guide to the three most-compared luxury hotel brands — service culture, consistency, points, and which to choose city by city.",
    updated: UPDATED,
    capsule:
      "Four Seasons is the consistency machine — the highest floor in luxury hospitality and the best with children. Ritz-Carlton is formal classicism attached to Bonvoy, so it is the only one of the three where points and status do real work, with more variance between properties. Rosewood is the design and food pick, with the smallest fleet and the most upside.",
    answer: [
      "The caricature that holds up in practice: Four Seasons is the consistency machine — the highest floor in luxury hospitality, superb with children, almost never the wrong answer and occasionally the boring one. Ritz-Carlton is formal classicism attached to Marriott's Bonvoy engine — the only one of the three where points and status do real work, with more property-to-property variance (the Reserve tier is exceptional; some city flags are dated). Rosewood is the style pick — residential 'sense of place' design, the best bars and restaurants of the three, a younger crowd, and the most upside when the property is great.",
      "Our atlas tracks {{hotels:name=ritz-carlton}} Ritz-Carltons, {{hotels:name=four seasons}} Four Seasons and {{hotels:name=rosewood}} Rosewoods, each with their advisor programs (FS Preferred Partner, Marriott STARS, Rosewood Elite) layering upgrades, breakfast and credits on top of published rates.",
    ],
    sections: [
      {
        h2: "The comparison table",
        table: {
          columns: ["", "Four Seasons", "Ritz-Carlton", "Rosewood"],
          rows: [
            ["Superpower", "Consistency; service without theater", "Bonvoy points/status; formal polish", "Design, F&B, sense of place"],
            ["Weakness", "Rarely surprises", "Uneven across the fleet", "Small fleet; sells out; pricing confidence"],
            ["Kids", "Best in class", "Very good", "Good, more style-conscious"],
            ["Loyalty program", "None (by design)", "Bonvoy — real value", "Modest (Rosewood One)"],
            ["Advisor program", "Preferred Partner", "Marriott STARS", "Rosewood Elite"],
            ["Book it when", "The stay must not fail", "Points matter or the flag is a Reserve", "The hotel itself is the destination"],
          ],
        },
      },
      {
        h2: "City-by-city instinct",
        paras: [
          "Same city, all three flags? Our defaults, with full acknowledgment that specific properties break the rule: business or family trip — Four Seasons; special occasion or food-led trip — Rosewood; points redemption or club-lounge habit — Ritz-Carlton. And always ask the property-level question: a tired flag from any brand loses to a brilliant one from another, which is exactly the knowledge an advisor trades in.",
          "Watch Ritz-Carlton Reserve separately — the handful of Reserves compete with Aman and Rosewood's best, not with standard Ritz-Carltons, and they book through STARS with meaningful benefits.",
        ],
      },
    ],
    faqs: [
      {
        q: "Which brand has the best suites for families?",
        a: "Four Seasons wins on connecting-room guarantees and kids' amenities as policy; Rosewood's residential layouts (kitchens, proper living rooms) suit longer family stays; Ritz-Carlton's club lounges quietly feed teenagers all day, which parents learn to price correctly.",
      },
      {
        q: "Are these brands' rates negotiable?",
        a: "Rates no, value yes: advisor-program bookings (Preferred Partner, STARS, Rosewood Elite) add $150–$400/night in benefits at published rates, and advisors see promotional inventory (third/fourth night free, suite deals) that rarely surfaces on brand.com.",
      },
      {
        q: "Where does Mandarin Oriental fit in this comparison?",
        a: "Closest to Four Seasons in consistency with a stronger Asian design identity and the best spas in the segment; our atlas carries {{hotels:name=mandarin oriental}} of them, {{hotels:program=Mandarin Oriental Fan Club}} filed under the Fan Club advisor program and the rest booking through Virtuoso. If the trip revolves around a spa, start there.",
      },
    ],
    related: [
      { href: "/answers/four-seasons-preferred-partner-benefits", label: "Four Seasons Preferred Partner, explained" },
      { href: "/answers/virtuoso-perks-vs-booking-direct", label: "How the advisor benefit stack works everywhere" },
      { href: "/hotels", label: "All three brands, property by property" },
    ],
  },

  {
    slug: "quietest-luxury-resorts-italy",
    category: "Hotels",
    question: "What are the quietest luxury resorts in Italy?",
    title: "The Quietest Luxury Resorts in Italy",
    description:
      "Where to find genuine quiet in Italian luxury — Tuscan estates, lake villas away from the ferry docks, Dolomites retreats and off-crowd islands — drawn from the {{hotels:country=Italy}} Italian properties in our atlas.",
    updated: "2026-10-01",
    capsule:
      "Quiet in Italy is bought with distance from a ferry dock or a funicular, and with a small room count. The quietest luxury hotels we book: Borgo Santo Pietro (22 rooms) and Castello di Velona (45) in Tuscany, Passalacqua (24) and Il Sereno (40) on Lake Como, Monastero Santa Rosa (20) on the Amalfi cliffs, Monaci delle Terre Nere (25) on Etna, and Aman Rosa Alpina (51) in the Dolomites.",
    answer: [
      "For genuine quiet, rather than Positano with a better pool deck, book small hotels that are the destination themselves. In Tuscany that means the farm and wine estates: Borgo Santo Pietro, 22 rooms in its own valley below Chiusdino; Castello di Velona, a castle above the Val d'Orcia; and Borgo San Felice, a whole hamlet inside a Chianti vineyard. On Lake Como it means Passalacqua's 24 rooms in a private park at Moltrasio, and Il Sereno on the east shore at Torno, away from the Bellagio and Varenna ferry docks. On the Amalfi Coast it is Monastero Santa Rosa, 20 rooms in a former monastery on the cliff between the towns rather than in one of them. In Sicily it is Monaci delle Terre Nere, 25 rooms on an organic estate on the slopes of Etna, and in the Dolomites, Aman Rosa Alpina in San Cassiano.",
      "The pattern: quiet in Italy is bought with distance from a ferry dock, a funicular, or a name that appears on tote bags, and with a room count under about sixty. Our atlas holds {{hotels:country=Italy}} Italian properties, of which the supplier flags {{hotels:country=Italy&experience=Seclusion}} for seclusion; the loudest thirty are the most requested, and the quietest thirty are the best reviewed afterward.",
    ],
    sections: [
      {
        h2: "The quiet list, by landscape",
        table: {
          caption: "Every property below is in our atlas with Virtuoso VIP benefits. Room counts are from the supplier feed, checked 2026-10-01.",
          columns: ["Region", "Property", "Rooms", "Why it's quiet"],
          rows: [
            ["Tuscany (Siena hills)", "Borgo Santo Pietro", "22", "A 13th-century farmhouse estate with its own gardens, farm and kitchen, at the end of a country road below Chiusdino"],
            ["Tuscany (Val d'Orcia)", "Castello di Velona", "45", "A castle above thermal vineyards; the nearest crowd is Montalcino, far below"],
            ["Tuscany (Chianti)", "Borgo San Felice", "63", "An entire restored hamlet inside a wine estate"],
            ["Tuscany (Arezzo)", "Il Borro Estate", "60", "The Ferragamo family valley — vineyards, villas, no through-road"],
            ["Tuscany (thermal)", "Fonteverde, San Casciano dei Bagni", "78", "A Medici spa town the tour buses skip"],
            ["Umbria", "Borgo dei Conti, Perugia", "40", "Umbria is Tuscany with half the traffic; this estate proves it"],
            ["Lake Como (west shore)", "Passalacqua, Moltrasio", "24", "An 18th-century villa in terraced private gardens, with no ferry dock or public promenade in front of it"],
            ["Lake Como (east shore)", "Il Sereno, Torno", "40", "On the quieter eastern shore near Como, well away from the Bellagio and Varenna ferry circus, with its own boats for the lake"],
            ["Lake Como (Menaggio)", "Grand Hotel Victoria", "73", "Menaggio's garden end, off the main ferry triangle"],
            ["Lake Garda", "Lefay Lago di Garda", "96", "A wellness estate high above the lake road"],
            ["Amalfi Coast", "Monastero Santa Rosa", "20", "A clifftop former monastery at Conca dei Marini, between the towns rather than in one"],
            ["Ischia", "Mezzatorre Hotel & Thermal Spa", "48", "A 16th-century watchtower in a pine cove; Capri's crowds stay on Capri"],
            ["Sicily (Etna)", "Monaci delle Terre Nere", "25", "An organic farm estate among lava-stone terraces on Etna's eastern slope, far from Taormina's crowds"],
            ["Sicily (Sciacca)", "Verdura Resort", "203", "230 private coastal acres with nothing to walk to; for more privacy, its 20 private villas"],
            ["Sardinia (Gallura hills)", "Petra Segreta, San Pantaleo", "27", "In granite hills above the Costa Smeralda, out of earshot of Porto Cervo"],
            ["Puglia", "Masseria Torre Maizza", "40", "A fortified 16th-century farmhouse among olive groves near Savelletri"],
            ["Dolomites", "Aman Rosa Alpina, San Cassiano", "51", "Alpine village hush, Aman staffing"],
            ["Dolomites", "Lefay Dolomiti, Pinzolo", "88", "Spa-first, ski-adjacent, serenely un-Cortina"],
          ],
        },
      },
      {
        h2: "Timing is half the quiet",
        paras: [
          "Even the famous coasts go quiet on the calendar's edges: Amalfi and the lakes in late September–October and May deliver open restaurants and empty pools; August delivers neither anywhere. If the heart is set on a marquee town — Positano, Taormina, Portofino — book the quietest property in it (Villa Treville's 22 rooms in Positano; Villa Sant'Andrea on Taormina's beach below the town) and take the town in doses.",
          "For total silence with Italian polish, remember the country's own countryside brands: the wine-estate hotels above are functionally Italy's answer to Aman pricing at half the rate, with cellars attached.",
        ],
      },
    ],
    evidence: {
      h2: "Every Italian property the supplier itself flags for seclusion",
      note:
        "Not our adjective: Seclusion is one of ten experience flags Virtuoso attaches to a property, so this list is the supplier's own answer to the question rather than ours. The hand-kept table above is where our advisors disagree with it.",
      query: "country=Italy&experience=Seclusion",
      sort: "smallest",
      limit: 20,
    },
    faqs: [
      {
        q: "Quietest option on the Amalfi Coast specifically?",
        a: "Monastero Santa Rosa (Conca dei Marini) for silence with a view of the whole coast; Villa Treville for Positano with the volume turned down. Both are small — book 6–9 months out for summer.",
      },
      {
        q: "Is Lake Como quiet anywhere in summer?",
        a: "Midweek, yes, away from Bellagio and Varenna docks: the Menaggio and Tremezzo garden shores, and hotels whose grounds are the destination (Villa d'Este, Villa Serbelloni's park). Weekends belong to Milan.",
      },
      {
        q: "What about Puglia or Sardinia?",
        a: "Puglia's masserie (Borgo Egnazia's quieter rivals) and northern Sardinia outside Porto Cervo (Petra Segreta in the hills, 7Pines' cliff end) are exactly the right instinct — Sardinia in June or September especially.",
      },
    ],
    related: [
      { href: "/answers/best-aman-for-first-timers", label: "For maximum quiet: which Aman first" },
      { href: "/hotels/italy", label: "Every Italian property in the atlas, one page each" },
      { href: "/answers/best-villas-under-2000-that-sleep-8", label: "Italian villas instead? Under $2,000/night options" },
    ],
  },

  {
    slug: "best-safari-lodges-with-vip-perks",
    // Filed under Safari, not Hotels. It is about the 72 Lodge / Safari
    // properties, but the reader asking it is planning a safari, and until the
    // Safari category existed there was nowhere else to put it.
    category: "Safari",
    question: "What are the best safari lodges you can book with VIP perks?",
    title: "Best Safari Lodges Bookable With VIP Perks",
    description:
      "The standout lodges among the {{hotels:category=Lodge / Safari}} safari and wilderness properties in our atlas — in Botswana, Kenya, South Africa and their neighbours — and what advisor booking adds on safari.",
    updated: UPDATED,
    capsule:
      "The safari lodges we send travelers to first are Jack's Camp in Botswana's Makgadikgadi, Belmond's Okavango camps, Bushmans Kloof in the malaria-free Cederberg, Elewana Loisaba on Kenya's Laikipia plateau, Londolozi and Singita in the Sabi Sand, and Fairmont Mara Safari Club. On safari the advisor's value is itinerary spine and private vehicles, not breakfast credits.",
    answer: [
      "From the {{hotels:category=Lodge / Safari}} safari and wilderness lodges in our atlas — most in Africa, the rest wilderness camps and ranches on other continents — the ones we send travelers to first: Jack's Camp in Botswana's Makgadikgadi (the great eccentric — Kalahari meerkats, desert-Baroque tents), Belmond's Botswana camps in the Okavango, Bushmans Kloof in the Cederberg (rock art, no malaria, family-friendly South Africa), Elewana Loisaba Tented Camp on Kenya's Laikipia plateau, Londolozi and Singita in the Sabi Sand, and Fairmont Mara Safari Club for the Mara circuit with big-hotel polish.",
      "On safari, advisor value is less about breakfast credits (everything's included anyway) and more about the itinerary spine: which camps combine, private-vehicle guarantees, guide requests, charter logistics between airstrips, and the green-season pricing that halves rates in months that are often better game viewing than the brochure months.",
    ],
    sections: [
      {
        h2: "Standouts from the atlas, by trip type",
        table: {
          columns: ["Trip", "Lodge", "Why"],
          rows: [
            ["The surrealist safari", "Jack's Camp, Makgadikgadi, Botswana", "Salt pans, habituated meerkats, museum-tent glamour — pairs with an Okavango water camp"],
            ["Classic Kenya", "Elewana Loisaba + Fairmont Mara Safari Club", "Laikipia exclusivity plus the Mara river-crossing theater"],
            ["Malaria-free family safari", "Bushmans Kloof, South Africa", "Cederberg wilderness, ancient rock art, kids welcome"],
            ["Okavango water-and-land", "Belmond Safaris (Eagle Island, Savute, Khwai)", "Mokoro canoes, elephants, Belmond service — Bellini Club perks apply"],
            ["Green-season value", "Anantara Kafue River Tented Camp, Zambia", "Emerging Kafue at pre-fame pricing"],
          ],
        },
        paras: [
          "The {{hotels:category=Lodge / Safari}} 'lodge/safari' properties also include wilderness lodges beyond Africa — Clayoquot in British Columbia, Blancaneaux in Belize, Explora in Patagonia and the Atacama, Huka Lodge in New Zealand — for travelers who want the safari rhythm (guides, wild luxury, all-inclusive days) on other continents.",
        ],
      },
      {
        h2: "What to actually optimize on safari",
        list: [
          "Camp combinations over camp names: two contrasting ecosystems (water + land in Botswana; Laikipia + Mara in Kenya) beat two famous lookalikes.",
          "Private vehicle on at least the photographic legs — the single upgrade that changes the trip most.",
          "Green/shoulder season: January–March Botswana and November Kenya price 30–50% below peak with dramatic skies and newborn everything.",
          "Charter weight limits (often 15kg soft bags) — plan camera gear accordingly.",
          "Book 9–15 months out for dry-season marquee camps; they sell by the tent, not the hundred rooms.",
        ],
      },
    ],
    faqs: [
      {
        q: "Botswana or Kenya for a first safari?",
        a: "Kenya for spectacle and value breadth (the Mara migration July–October); Botswana for exclusivity and water-based variety at higher cost. Both in 10–12 days is the honeymoon classic for a reason.",
      },
      {
        q: "Are safaris all-inclusive?",
        a: "At this tier, nearly always: meals, drinks, twice-daily game drives, and often laundry. The bill's variables are park fees, charters and premium extras (helicopter legs, private vehicles) — which is where itinerary design earns its keep.",
      },
      {
        q: "When do lodges discount?",
        a: "Green season (roughly Nov–May southern Africa, Mar–May and Nov East Africa) and long-stay/pay-3-stay-4 offers your advisor sees before they're public. Peak-season marquee camps essentially never discount — book those early instead.",
      },
    ],
    evidence: {
      h2: "The lodges themselves, smallest camps first",
      note:
        "Every property the supplier files as a lodge or safari camp. Size is the honest sort here: a nine-tent camp and a 200-room game reserve are different holidays under one category.",
      query: "category=Lodge / Safari",
      sort: "smallest",
      limit: 20,
    },
    related: [
      { href: "/atlas/hotel?category=Lodge+%2F+Safari", label: "All {{hotels:category=Lodge / Safari}} safari & wilderness lodges on the atlas map" },
      { href: "/journeys/safari", label: "The other half: every safari itinerary, day by day" },
      { href: "/answers/which-safari-operator-should-you-book", label: "Which operator to book the trip through" },
      { href: "/answers/virtuoso-perks-vs-booking-direct", label: "How advisor booking works at lodges" },
    ],
  },

  {
    slug: "best-ski-in-ski-out-luxury-hotels",
    category: "Hotels",
    question: "What are the best ski-in/ski-out luxury hotels?",
    title: "Best Ski-In/Ski-Out Luxury Hotels: Alps vs. Rockies",
    description:
      "The true ski-in/ski-out properties among the luxury set — Courchevel's palaces, Zermatt classics, and North America's Deer Valley, Vail, Whistler and Aspen options — compared honestly.",
    updated: UPDATED,
    capsule:
      "The true ski-in/ski-out luxury hotels are Courchevel 1850's trio — Cheval Blanc, Airelles and L'Apogée — plus Four Seasons Megève in the Alps; and in North America, Stein Eriksen Residences and Goldener Hirsch at Deer Valley, Four Seasons and Fairmont Chateau at Whistler, and Grand Hyatt Vail. Zermatt and Aspen have almost none, for reasons of town layout.",
    answer: [
      "In the Alps, the benchmark ski-in/ski-out palaces are Courchevel 1850's trio — Cheval Blanc, Airelles, and L'Apogée — where the Trois Vallées' groomers run essentially to the ski butler's door; Megève adds Four Seasons Megève (the brand's alpine flagship) and Alpaga for village charm. In North America, the honest ski-in/ski-out list is led by Stein Eriksen Residences and Goldener Hirsch in Deer Valley, Four Seasons Whistler and Fairmont Chateau Whistler at the base of North America's biggest terrain, Grand Hyatt Vail on the creek with its own lift, and in Aspen — where true ski-in/ski-out barely exists — MOLLIE and the W put you steps from the gondola rather than on the snow.",
      "The Alps sell altitude romance, michelin density and ski butlers; the Rockies sell snow reliability, service informality and direct flights. Both are in our atlas — {{hotels:category=Mountain / Ski}} mountain and ski properties, {{hotels:experience=Ski}} of them flagged for skiing by the supplier — with VIP amenities — and in ski hotels the advisor's real work is January and March weeks that cost half of Christmas.",
    ],
    sections: [
      {
        h2: "The list, with candor about 'ski-in/ski-out'",
        table: {
          caption: "Hand-kept, from the {{hotels:category=Mountain / Ski}} mountain and ski properties in the atlas. \"Ski-in/ski-out\" is our verdict, not a supplier flag — which is exactly why it is a written table rather than a query.",
          columns: ["Property", "Resort", "Real verdict"],
          rows: [
            ["Cheval Blanc Courchevel", "Courchevel 1850", "True ski-in/out; LVMH polish; the segment's benchmark"],
            ["Airelles Courchevel", "Courchevel 1850", "True ski-in/out; maximalist fantasy; best kids' program in the Alps"],
            ["L'Apogée Courchevel", "Courchevel 1850", "True ski-in/out via Jardin Alpin; the quiet-confident choice"],
            ["Four Seasons Megève", "Megève", "On-piste at Mont d'Arbois; gentler terrain, superb spa"],
            ["Alpaga", "Megève", "Chalet hamlet — shuttle to lifts, charm compensates"],
            ["Grand Hotel Zermatterhof / Mont Cervin Palace", "Zermatt", "Not ski-in/out (car-free town) — but Zermatt logistics are easy and the Matterhorn forgives all"],
            ["Stein Eriksen Residences", "Deer Valley", "True ski-in/out; residence-style space; Deer Valley grooming cult"],
            ["Goldener Hirsch", "Deer Valley", "Ski-in/out at Silver Lake; Austrian-Aspen hybrid charm"],
            ["Four Seasons Whistler", "Whistler Blackcomb", "Ski concierge shuttle to base (not on-snow) — biggest terrain on the continent"],
            ["Fairmont Chateau Whistler", "Whistler Blackcomb", "True ski-in/out at Blackcomb base"],
            ["Grand Hyatt Vail", "Vail", "Own chairlift (No. 20) — the sleeper ski-in/out of Vail"],
            ["MOLLIE Aspen / W Aspen", "Aspen", "Gondola-steps, not ski-in/out; Aspen's trade-off is the town itself"],
          ],
        },
      },
      {
        h2: "Alps or Rockies, decided honestly",
        paras: [
          "Choose the Alps when the trip is as much dinner as descent: Courchevel 1850 holds more Michelin stars than most capital cities, and the Trois Vallées' 600km dwarf anything in North America. Choose the Rockies when snow certainty, tree-skiing, and effortless logistics (direct flights, English-speaking ski school, no lunchtime reservations arms race) matter more — Deer Valley for polish, Whistler for terrain, Vail for both in bulk.",
          "January (post–Jan 6) and the last three weeks of March are the luxury ski calendar's open secret: identical mountains, 40–50% off festive-week rates, and actual availability at the palaces above.",
        ],
      },
    ],
    evidence: {
      h2: "The mountain and ski properties in the atlas",
      note:
        "Every property the supplier flags for skiing, largest first. Compare it against the hand-kept verdicts above: the supplier's Ski flag says a property serves skiers, not that you can put your boots on in the lobby and push off.",
      query: "experience=Ski",
      sort: "rooms",
      limit: 20,
    },
    faqs: [
      {
        q: "What's the single best ski hotel in the world right now?",
        a: "If forced: Cheval Blanc Courchevel for the complete package — position, service, food, spa. If the metric is memories-per-dollar with kids: Airelles. If it's terrain-per-day: sleep at Fairmont Chateau Whistler and ski until your legs file a complaint.",
      },
      {
        q: "Is Zermatt worth it without ski-in/ski-out?",
        a: "Completely. The car-free village, the Matterhorn, and Europe's highest lift-served terrain outweigh the five-minute electric-taxi logistics; Mont Cervin Palace and the Zermatterhof both run ski shuttles and slopeside depots.",
      },
      {
        q: "When should I book festive-week ski?",
        a: "Christmas/New Year at the Courchevel palaces and Deer Valley books 10–12 months out, often with 7–10 night minimums. If you're reading this in summer for the coming winter, call your advisor today, not after the leaves turn.",
      },
    ],
    related: [
      { href: "/atlas/hotel", label: "Ski properties on the atlas map" },
      { href: "/hotels", label: "Every property in the atlas, one page each" },
      { href: "/answers/virtuoso-perks-vs-booking-direct", label: "The perk stack at ski palaces" },
      { href: "/answers/best-villas-under-2000-that-sleep-8", label: "Ski villas instead — Colorado options under $2,000" },
    ],
  },
  {
    slug: "hotel-brand-advisor-programs-compared",
    category: "Hotels",
    question: "Marriott STARS, IHG Destined, Hilton for Luxury: what do hotel brand advisor programs add?",
    title: "Hotel Brand Advisor Programs Compared: STARS, Destined, Hilton for Luxury and More",
    description:
      "What the big hotel groups' own advisor programs add to a stay, how they differ from Virtuoso, and which properties carry them, across the {{hotels:program=Marriott STARS}} Marriott STARS, {{hotels:program=IHG Destined}} IHG Destined and {{hotels:program=Hilton for Luxury}} Hilton for Luxury properties in our atlas.",
    updated: "2026-10-01",
    capsule:
      "Hotels with advisor perks, brand by brand: Four Seasons (Preferred Partner), Marriott's Ritz-Carlton and St. Regis (STARS), IHG's InterContinental and Six Senses (Destined), Hilton's Waldorf Astoria and Conrad (Hilton for Luxury), Hyatt (Privé), Rosewood (Elite), Shangri-La (The Luxury Circle), Peninsula (Pen Club), Mandarin Oriental (Fan Club) and Jumeirah (Passport to Luxury). Booked through a member advisor at the hotel's own rate, each typically adds breakfast for two, a $100 credit, an upgrade when available and early or late check-out.",
    answer: [
      "Which hotel brands give perks through an advisor? Nearly every luxury group does, each through its own invitation-only program: Four Seasons Preferred Partner, Marriott STARS, IHG Destined, Hilton for Luxury, Hyatt Privé, Rosewood Elite, Shangri-La The Luxury Circle, The Peninsula Pen Club, Mandarin Oriental Fan Club and Jumeirah Passport to Luxury. The list below gives each brand's benefits; independent hotels such as Aman, Belmond and Cheval Blanc give theirs through Virtuoso.",
      "Hotel groups keep a short list of travel advisors whose clients they most want, and give those clients a standard set of benefits. The names differ but the shape is similar: daily breakfast for two, a property credit (commonly $100), an upgrade on arrival when available, early check-in and late check-out when available, and a welcome amenity. The rate is the hotel's own flexible rate, so the benefits cost nothing extra.",
      "These brand programs sit alongside Virtuoso rather than replacing it. At a Ritz-Carlton or St. Regis, Marriott STARS is often the stronger stack; at an InterContinental or Six Senses, IHG Destined. An advisor who holds several can book each hotel through whichever serves you best. In our atlas, {{hotels:program=Marriott STARS}} properties are filed under Marriott STARS, {{hotels:program=IHG Destined}} under IHG Destined, {{hotels:program=Hilton for Luxury}} under Hilton for Luxury, {{hotels:program=Rosewood Elite}} under Rosewood Elite and {{hotels:program=Shangri-La The Luxury Circle}} under Shangri-La's Luxury Circle.",
    ],
    sections: [
      {
        h2: "Hotel brands with advisor perks, brand by brand",
        list: [
          "Four Seasons — Preferred Partner: breakfast for two, $100 credit per stay ($200 in suites), upgrade, early and late check-out.",
          "Marriott (Ritz-Carlton, St. Regis, EDITION, The Luxury Collection) — STARS: breakfast for two, $100 credit, upgrade, early and late check-out.",
          "IHG (InterContinental, Six Senses, Regent, Kimpton) — Destined: breakfast, a property credit and upgrade priority, varying by hotel.",
          "Hilton (Waldorf Astoria, Conrad, LXR) — Hilton for Luxury: breakfast for two, $100 credit, upgrade, early and late check-out; some resorts add spa access.",
          "Hyatt (Park Hyatt, Alila, Andaz and others) — Privé: breakfast, a property credit and upgrade priority, varying by hotel.",
          "Rosewood — Rosewood Elite: breakfast for two, $100 food and beverage credit, upgrade, early and late check-out.",
          "Shangri-La — The Luxury Circle: breakfast for two and an upgrade; at many hotels an automatic move to Horizon Club access, with a $100 credit in club rooms and suites.",
          "The Peninsula — Pen Club: full breakfast for two, $100 credit, upgrade, early and late check-out.",
          "Mandarin Oriental — Fan Club: breakfast for two, $100 credit, upgrade; some suites add airport transfers.",
          "Jumeirah — Passport to Luxury: breakfast for two, $100 credit, upgrade; suites at some hotels add a massage.",
          "Independent hotels and smaller brands (Aman, Belmond, Cheval Blanc, Capella, Oetker and most Relais & Châteaux) — usually through Virtuoso, with a similar list.",
        ],
        paras: [
          "Benefits are as filed for 2026 in the supplier feed behind our atlas, checked 2026-10-01. Hotels vary the details, and each property's own page lists what is on file for it.",
        ],
      },
      {
        h2: "The programs, and the hotels they cover",
        table: {
          caption: "Benefits vary by hotel and are listed in full on each property's own page. Counts are from the atlas, refreshed nightly.",
          columns: ["Program", "Group", "Typical brands", "In our atlas"],
          rows: [
            ["Marriott STARS", "Marriott", "Ritz-Carlton, St. Regis, EDITION, The Luxury Collection", "{{hotels:program=Marriott STARS}}"],
            ["IHG Destined", "IHG", "InterContinental, Six Senses, Regent, Kimpton", "{{hotels:program=IHG Destined}}"],
            ["Hilton for Luxury", "Hilton", "Waldorf Astoria, Conrad, LXR", "{{hotels:program=Hilton for Luxury}}"],
            ["Four Seasons Preferred Partner", "Four Seasons", "Four Seasons", "{{hotels:program=Four Seasons Preferred Partner}}"],
            ["Rosewood Elite", "Rosewood", "Rosewood", "{{hotels:program=Rosewood Elite}}"],
            ["Shangri-La The Luxury Circle", "Shangri-La", "Shangri-La", "{{hotels:program=Shangri-La The Luxury Circle}}"],
            ["The Peninsula Pen Club", "Peninsula", "The Peninsula", "{{hotels:program=The Peninsula Pen Club}}"],
          ],
        },
      },
      {
        h2: "How they stack with your loyalty status",
        paras: [
          "Brand advisor programs and loyalty status usually work together, not against each other. A booking through a member advisor at a qualifying rate still earns points and elite-night credit, and your status benefits still apply. Where the two overlap, as with breakfast, you get one breakfast, not two, but the property credit and the advisor's relationship with the hotel are added on top.",
          "The part that does not show in any table is who is looking after the reservation. A program booking is flagged to the hotel before you arrive, and the advisor has a named contact to call when something needs fixing. That is worth more on a complicated stay than any single benefit.",
        ],
      },
    ],
    evidence: {
      h2: "The Marriott STARS properties, from the supplier feed",
      note:
        "Every property in the atlas filed under Marriott STARS, largest first. Each links to its own page, where the benefits currently on file for it are listed in full.",
      query: "program=Marriott STARS",
      sort: "rooms",
      limit: 15,
    },
    faqs: [
      {
        q: "Can I book these benefits myself?",
        a: "No. They are only available through an advisor who is a member of the program, and membership is by invitation from the hotel group. The rate is the same one you would see on the hotel's website.",
      },
      {
        q: "Do they apply to prepaid or discounted rates?",
        a: "Usually not. The benefits are attached to the flexible rate, and sometimes to published promotions. A deeply discounted prepaid rate may cost less but carries no benefits, and an advisor can price both so you can compare.",
      },
      {
        q: "Is Virtuoso better than a brand program?",
        a: "Neither is better in general; it depends on the hotel. At some the brand program offers more, at others Virtuoso does, and a hotel only applies one set per stay. The right choice is whichever gives more at the particular property.",
      },
    ],
    related: [
      { href: "/answers/virtuoso-perks-vs-booking-direct", label: "Virtuoso perks vs. booking direct" },
      { href: "/answers/four-seasons-preferred-partner-benefits", label: "The Four Seasons program in detail" },
      { href: "/hotels", label: "Every property in the atlas, one page each" },
    ],
  },
];
