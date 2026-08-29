// Answer pages — safari.
//
// The collection had no answers at all, and the reason is worth recording
// because it was structural rather than an oversight of subject matter: safari
// shipped as the eighth atlas with pins on the globe, a colour, a page and a
// menu entry, but with no query backend — so The Guide could not search it, and
// `category: "Safari"` was not in CATEGORY_ORDER, so an answer filed under it
// would have been dropped from /answers without a word. Both are fixed; these
// are the first two answers that could exist.
//
// Counts are queries (lib/seo/facts.mjs), not typed numbers. The hotel-atlas
// terms cover the LODGES; the itinerary counts in the prose come from the
// safari journey atlas, which the fact engine does not read yet — those are
// stated as of `UPDATED` and are the reason this module has one.

const UPDATED = "2026-08-28";

export const safariAnswers = [
  {
    slug: "which-safari-operator-should-you-book",
    category: "Safari",
    question: "Which safari operator should you actually book — andBeyond, Wilderness, A&K or Ker & Downey?",
    title: "Choosing a Safari Operator: andBeyond vs Wilderness vs A&K vs Ker & Downey",
    description:
      "How the major safari operators really differ — who owns their camps, who charters their own aircraft, who builds bespoke versus scheduled departures — across the 274 safari itineraries in our atlas.",
    updated: UPDATED,
    capsule:
      "Book Wilderness or andBeyond when you want the operator to own the camps you sleep in, which is what buys consistency and access in Botswana and the Okavango. Book Abercrombie & Kent or Micato for East Africa logistics and scheduled departures, and Ker & Downey or Artisans of Leisure when the itinerary should be built around you rather than chosen from a list.",
    answer: [
      "The distinction that matters is whether the operator owns the camps. Wilderness and andBeyond do: their itineraries move you between their own properties, which is why their Botswana and Okavango trips run so smoothly and why their guiding is consistent from camp to camp. Abercrombie & Kent and Micato do not own most of the camps but own the logistics — the charters, the ground teams, the airport fixers — which is what East Africa actually runs on, and why they dominate Kenya and Tanzania. Ker & Downey, Artisans of Leisure and Remote Lands sit at the bespoke end: fewer scheduled departures, more of a trip designed around your dates.",
      "Our atlas holds 274 safari itineraries across those operators, and the concentration tells you where each is strongest: Abercrombie & Kent 80, Wilderness 44, African Travel 40, andBeyond 33, Artisans of Leisure 31, Ker & Downey 27, Micato 11. Nearly all of them — 268 of 274 — are on-demand departures with a booking window rather than a fixed date, which is the single most useful thing to know before you start: you are choosing a trip shape, not a seat on a departure.",
    ],
    sections: [
      {
        h2: "The operators, by what they actually control",
        table: {
          caption: "Itinerary counts from the safari atlas, refreshed nightly from the Virtuoso Partner API.",
          columns: ["Operator", "Owns", "Strongest in", "Book them when"],
          rows: [
            ["Wilderness", "Its own camps, its own aircraft", "Botswana, Namibia, Zambia, Zimbabwe", "You want one operator accountable for the whole trip"],
            ["andBeyond", "Its own lodges", "South Africa (Phinda), Botswana, East Africa", "Design and food matter as much as game viewing"],
            ["Abercrombie & Kent", "Logistics, ground teams, charters", "Kenya, Tanzania, Egypt, multi-country", "The itinerary crosses borders or needs charters"],
            ["Micato Safaris", "Ground operation in East Africa", "Kenya and Tanzania", "First safari, and you want to be looked after"],
            ["Ker & Downey", "Nothing — it designs", "Bespoke Africa, wide range", "The trip should be built rather than chosen"],
            ["Artisans of Leisure", "Nothing — it designs", "Multi-country, culture plus wildlife", "Safari is one half of a longer trip"],
            ["Natural Habitat", "Naturalist programme", "Churchill polar bears, Alaska, the Galápagos", "The wildlife is the whole point, Africa or not"],
          ],
        },
        paras: [
          "The camp-owning distinction is not a marketing point: it decides what happens when something goes wrong. A vehicle breakdown at a Wilderness camp is a Wilderness problem, and a Wilderness aircraft moves you. The same breakdown on a bought-in camp is a phone call between two companies, which is exactly the moment an advisor earns their place.",
        ],
      },
      {
        h2: "The half of a safari that is not the itinerary",
        paras: [
          "A safari has two halves and travellers reliably shop for only one. The itinerary — which countries, which camps, in what order — is the operator's. The lodges are the atlas's: {{hotels:category=Lodge / Safari}} safari and wilderness properties, {{hotels:category=Lodge / Safari&perks=true}} of them with VIP benefits on file that a booking through an advisor carries. Booking the trip through one channel and the camps through another loses those benefits; booking both together does not.",
          "On safari the advisor's value is also not what it is in a hotel. Everything is already included — meals, drinks, twice-daily game drives, often laundry — so there is no breakfast credit to add. What there is: which camps combine into one trip, private-vehicle guarantees on the photographic legs, guide requests by name, the charter weight limits nobody mentions until you are at the airstrip, and green-season pricing that halves the rate in months that often view better than the brochure ones.",
        ],
      },
    ],
    evidence: {
      h2: "The safari lodges in the atlas, smallest camps first",
      note:
        "Every property the supplier files as a lodge or safari camp. Size is the honest sort: a nine-tent camp and a 200-room game reserve are different holidays under one heading. Each links to its own page, where the benefits currently on file for it are listed in full.",
      query: "category=Lodge / Safari",
      sort: "smallest",
      limit: 15,
    },
    faqs: [
      {
        q: "Is a camp-owning operator always the better choice?",
        a: "For a first safari in Botswana, usually yes — the consistency is worth it. For East Africa, no: the best camps in the Mara and the Serengeti are independently owned, so an operator that owns the logistics rather than the beds is the stronger partner there.",
      },
      {
        q: "Why do almost none of these have fixed departure dates?",
        a: "268 of the 274 itineraries in our atlas are on-demand: the operator publishes a booking window and builds your dates inside it. Scheduled small-group departures exist (A&K and Micato run them) but they are the minority. It means you are choosing a trip shape first and dates second, which is the opposite of how cruise shopping works.",
      },
      {
        q: "Does booking through an advisor cost more?",
        a: "No. The operator pays the agency a commission out of its own marketing budget, at the same published rate. What you gain is someone who has been to the camps, knows which combine well, and can reach the operator's owner rather than a call centre when a charter shifts.",
      },
    ],
    related: [
      { href: "/journeys/safari", label: "Every safari itinerary in the atlas, day by day" },
      { href: "/answers/best-safari-lodges-with-vip-perks", label: "The lodges themselves, and what advisor booking adds" },
      { href: "/atlas/safari", label: "The safari atlas, on the map" },
      { href: "/answers/virtuoso-perks-vs-booking-direct", label: "How the advisor benefit stack works generally" },
    ],
  },

  {
    slug: "botswana-vs-kenya-vs-south-africa-first-safari",
    category: "Safari",
    question: "Botswana, Kenya or South Africa — where should your first safari be?",
    title: "Where to Take a First Safari: Botswana vs Kenya vs South Africa",
    description:
      "An advisor's honest comparison of the three most-booked first-safari countries — game density, cost, malaria, family suitability and season — drawn from the safari itineraries and lodges in our atlas.",
    updated: UPDATED,
    capsule:
      "Choose Kenya for spectacle and value, and for the Great Migration between July and October. Choose Botswana for exclusivity, water-based game viewing in the Okavango and the fewest other vehicles, at the highest cost. Choose South Africa for a first safari with children, a malaria-free option, and the easiest pairing with a city and a coastline.",
    answer: [
      "Kenya is the highest-density, best-value first safari: the Masai Mara concentrates more game into fewer hours than anywhere else on the list, the Great Migration crosses between July and October, and the conservancies bordering the reserve deliver Mara game viewing with a fraction of the vehicles. Botswana is the exclusivity trade: the Okavango Delta sells low-density concessions where you may not see another vehicle all day, plus mokoro and boat game viewing nothing else offers, at meaningfully higher cost. South Africa is the easiest first safari — malaria-free reserves exist, the Sabi Sand delivers reliable leopard, and Cape Town and the winelands sit at the end of a short flight, which is why it is the one that works with children and with sceptical partners.",
      "Our atlas holds 274 safari itineraries, concentrated exactly where you would expect: Kenya 54, Tanzania 50, Botswana 46, South Africa 40, Zambia 19, Namibia 17, Rwanda 16, Zimbabwe 10. On the lodge side it holds {{hotels:category=Lodge / Safari}} safari and wilderness properties: {{hotels:category=Lodge / Safari&country=South Africa}} in South Africa, {{hotels:category=Lodge / Safari&country=Botswana}} in Botswana, {{hotels:category=Lodge / Safari&country=Kenya}} in Kenya — which is itself a useful signal about where the private-reserve lodge market is deepest, and where the good beds are independently owned rather than filed under a preferred-partner programme.",
    ],
    sections: [
      {
        h2: "The three, compared honestly",
        table: {
          columns: ["", "Kenya", "Botswana", "South Africa"],
          rows: [
            ["Game density", "Highest — the Mara concentrates everything", "Lower per hour, higher quality of sighting", "Very good; Sabi Sand is the leopard capital"],
            ["Other vehicles", "Many in the reserve, few in the conservancies", "Fewest anywhere", "Few in private reserves, many in Kruger proper"],
            ["Cost", "Best value of the three", "Highest — concessions price exclusivity", "Widest range, from modest to Singita"],
            ["Water game viewing", "No", "Yes — mokoro, boats, flooded plains", "No"],
            ["Malaria", "Present", "Present", "Malaria-free reserves exist (Madikwe, Cederberg)"],
            ["With children", "Good from about 8", "Most camps set a minimum age", "Best of the three — family lodges and no malaria"],
            ["Pairs with", "Beach at Lamu or Zanzibar", "Victoria Falls, Cape Town", "Cape Town, the winelands, the Garden Route"],
            ["Best months", "Jul–Oct migration; Jan–Feb calving", "May–Sep dry season, flood at its highest", "May–Sep dry; year-round workable"],
          ],
        },
      },
      {
        h2: "What actually decides it",
        list: [
          "Children under twelve, or a first-timer who needs a city at the end: South Africa, and stop debating.",
          "One safari, one lifetime, and the migration is the picture in your head: Kenya, July to October, booked a year out.",
          "You have been on safari before and the thing you did not like was the queue of vehicles at a sighting: Botswana.",
          "The budget is the constraint but the trip is not negotiable: Kenya in the green season, or South Africa outside the Sabi Sand.",
          "Two contrasting ecosystems beat two famous ones — water plus land in Botswana, Laikipia plus the Mara in Kenya — every time.",
        ],
      },
      {
        h2: "The mistake to avoid",
        paras: [
          "Booking too many camps. Three nights is the minimum that makes a camp worth the charter that got you there, and a ten-day trip is therefore three camps, not five. The itineraries in our atlas that read best are the ones that move twice; the ones travellers regret are the ones that move four times and spend a third of the trip on airstrips.",
        ],
      },
    ],
    evidence: {
      h2: "Southern African lodges in the atlas",
      note:
        "The South African properties, smallest first — the country with the deepest lodge inventory in the atlas and the easiest first safari. Each links to its own page with the VIP benefits on file for it.",
      query: "category=Lodge / Safari&country=South Africa",
      sort: "smallest",
      limit: 15,
    },
    faqs: [
      {
        q: "Is Tanzania a better first safari than Kenya?",
        a: "It is the better second one. The Serengeti and Ngorongoro are magnificent and the migration is the same animals on the other side of a river, but Tanzania costs more, its park fees are higher, and its internal flights are longer. Kenya delivers the same first-safari feeling for less.",
      },
      {
        q: "How many days do I need?",
        a: "Eight nights on the ground is the honest minimum for one country and two camps; ten to twelve makes a two-country trip or a safari-plus-beach work. Anything under a week spends too much of itself in transit.",
      },
      {
        q: "When is green season actually worth it?",
        a: "Botswana in January to March and East Africa in March to May and November: rates fall 30–50%, the light is dramatic, and everything has just given birth. The trade is rain, thicker grass, and some camps closed. For a first safari in the dry season, book early instead — the marquee camps essentially never discount.",
      },
    ],
    related: [
      { href: "/journeys/safari", label: "Every safari itinerary in the atlas, day by day" },
      { href: "/answers/which-safari-operator-should-you-book", label: "Which operator to book it through" },
      { href: "/answers/best-safari-lodges-with-vip-perks", label: "The standout lodges, and what advisor booking adds" },
      { href: "/hotels/south-africa", label: "Every South African property in the atlas" },
    ],
  },
];
