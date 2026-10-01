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
// Counts are queries (lib/seo/facts.mjs), not typed numbers — both halves now.
// `{{hotels:…}}` queries the hotel feed for the LODGES; `{{journeys:…}}` and
// `{{departures:…}}` query data/atlas/shared/journey-facts.json for the
// ITINERARIES. The two journey tokens exist because both numbers are true and
// they differ: safari holds 250 itineraries and 274 departures, expedition
// cruise 902 and 3,662. Writing the departure count and linking to the
// itinerary pages is the kind of near-miss that makes a page look wrong to
// somebody checking it.

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
      "Our atlas holds {{journeys:collection=safari}} safari itineraries across those operators, and the concentration tells you where each is strongest: Abercrombie & Kent {{journeys:collection=safari&operator=Abercrombie %26 Kent}}, Wilderness {{journeys:collection=safari&operator=Wilderness}}, African Travel {{journeys:collection=safari&operator=African Travel}}, andBeyond {{journeys:collection=safari&operator=andBeyond}}, Artisans of Leisure {{journeys:collection=safari&operator=Artisans of Leisure}}, Ker & Downey {{journeys:collection=safari&operator=Ker %26 Downey}}, Micato {{journeys:collection=safari&operator=Micato Safaris}}. Almost all of them — {{journeys:collection=safari&onDemand=true}} of {{journeys:collection=safari}} — are on-demand departures with a booking window rather than a fixed date, which is the single most useful thing to know before you start: you are choosing a trip shape, not a seat on a departure.",
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
        a: "{{journeys:collection=safari&onDemand=true}} of the {{journeys:collection=safari}} itineraries in our atlas are on-demand: the operator publishes a booking window and builds your dates inside it. Scheduled small-group departures exist (A&K and Micato run them) but they are the minority. It means you are choosing a trip shape first and dates second, which is the opposite of how cruise shopping works.",
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
    title: "Botswana vs Kenya vs South Africa: Where to Take a First Safari",
    description:
      "Botswana vs Kenya vs South Africa for a first safari: a verdict grid by traveler, then an honest comparison of game density, cost, malaria, family suitability and season, drawn from the safari itineraries and lodges in our atlas.",
    updated: "2026-10-01",
    capsule:
      "Choose Kenya for spectacle and value, and for the Great Migration between July and October. Choose Botswana for exclusivity, water-based game viewing in the Okavango and the fewest other vehicles, at the highest cost. Choose South Africa for a first safari with children, a malaria-free option, and the easiest pairing with a city and a coastline.",
    answer: [
      "Kenya is the highest-density, best-value first safari: the Masai Mara concentrates more game into fewer hours than anywhere else on the list, the Great Migration crosses between July and October, and the conservancies bordering the reserve deliver Mara game viewing with a fraction of the vehicles. Botswana is the exclusivity trade: the Okavango Delta sells low-density concessions where you may not see another vehicle all day, plus mokoro and boat game viewing nothing else offers, at meaningfully higher cost. South Africa is the easiest first safari — malaria-free reserves exist, the Sabi Sand delivers reliable leopard, and Cape Town and the winelands sit at the end of a short flight, which is why it is the one that works with children and with sceptical partners.",
      "Our atlas holds {{journeys:collection=safari}} safari itineraries, concentrated exactly where you would expect: Kenya {{journeys:collection=safari&country=Kenya}}, Tanzania {{journeys:collection=safari&country=Tanzania}}, Botswana {{journeys:collection=safari&country=Botswana}}, South Africa {{journeys:collection=safari&country=South Africa}}, Zambia {{journeys:collection=safari&country=Zambia}}, Namibia {{journeys:collection=safari&country=Namibia}}, Rwanda {{journeys:collection=safari&country=Rwanda}}, Zimbabwe {{journeys:collection=safari&country=Zimbabwe}}. On the lodge side it holds {{hotels:category=Lodge / Safari}} safari and wilderness properties: {{hotels:category=Lodge / Safari&country=South Africa}} in South Africa, {{hotels:category=Lodge / Safari&country=Botswana}} in Botswana, {{hotels:category=Lodge / Safari&country=Kenya}} in Kenya — which is itself a useful signal about where the private-reserve lodge market is deepest, and where the good beds are independently owned rather than filed under a preferred-partner programme.",
    ],
    sections: [
      {
        h2: "The verdict, by traveler",
        table: {
          caption: "One winner per row. Where two countries are close, the runner-up is named.",
          columns: ["If this is you", "Go to", "Runner-up", "Why"],
          rows: [
            ["First safari, short on time (under a week)", "Kenya", "South Africa", "The Masai Mara shows the most game per hour, and Nairobi has the most direct long-haul flights"],
            ["The Great Migration is the picture in your head", "Kenya, July to October", "Tanzania", "River crossings on the Mara; calving in Tanzania's southern Serengeti in January to March"],
            ["Travelling with children under twelve", "South Africa", "Kenya", "Malaria-free reserves, family lodges, and camps without a minimum age"],
            ["You want to avoid malaria altogether", "South Africa", "—", "Madikwe and the Eastern Cape reserves are malaria-free; Kenya and Botswana are not"],
            ["You want no other vehicles at a sighting", "Botswana", "Kenya's conservancies", "Private Okavango concessions limit vehicles; Mara conservancies cap them too"],
            ["You want water: mokoro, boats, flooded plains", "Botswana", "—", "The Okavango Delta is the only one of the three with water-based game viewing"],
            ["Leopard is the animal you most want to see", "South Africa (Sabi Sand)", "Botswana", "Habituated leopards and off-road tracking in the private reserves"],
            ["Best value for a luxury standard", "Kenya", "South Africa", "Comparable camps cost less than Botswana's concessions; green season cuts rates further"],
            ["Price is no object and this is a milestone", "Botswana", "Kenya", "Low-density concessions and the most exclusive camps in Africa"],
            ["Safari plus a city, wine country or a coastline", "South Africa", "Kenya with Lamu or Zanzibar", "Cape Town and the winelands are a short flight from the reserves"],
            ["A sceptical partner who needs convincing", "South Africa", "Kenya", "Easy logistics, no malaria in some reserves, and Cape Town at the end"],
          ],
        },
      },
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
  {
    slug: "gorilla-trekking-rwanda-vs-uganda",
    category: "Safari",
    question: "Gorilla trekking: Rwanda or Uganda?",
    title: "Gorilla Trekking in Rwanda vs. Uganda: How to Choose",
    description:
      "Rwanda's Volcanoes National Park against Uganda's Bwindi: permit costs, how hard the trek is, how you get there, and which lodges make the trip, across the {{journeys:collection=safari&region=GREATAPES}} great-ape itineraries in our atlas.",
    updated: "2026-10-01",
    capsule:
      "Gorilla permits as of October 2026: $1,500 per trek in Rwanda, $800 per trek in Uganda, and $1,500 for Uganda's four-hour habituation experience. Choose Rwanda when time is short and comfort matters: Volcanoes National Park is about three hours by road from Kigali and the lodges are among Africa's best. Choose Uganda when you have more days and want better value: the forest is wilder, the treks often harder, and Kibale adds the best chimpanzee tracking in Africa.",
    answer: [
      "Both countries give you the same thing at the end of the trek: one hour, in a group of at most eight, with a habituated mountain gorilla family. What differs is everything around that hour. Rwanda is the efficient, polished version. You land in Kigali, drive about three hours to Volcanoes National Park, and trek from a lodge that is often the best room of the whole Africa trip. The price of that ease is the permit, $1,500 per person per trek.",
      "Uganda is the version with more forest and more time in it. Bwindi Impenetrable is steeper and denser, reached by light aircraft or a long drive, and its permits cost $800. It also has more gorilla families to allocate, a four-hour habituation experience that Rwanda does not offer, and Kibale Forest, which is where serious chimpanzee tracking happens. Of the {{journeys:collection=safari&region=GREATAPES}} great-ape itineraries in our atlas, {{journeys:collection=safari&country=Rwanda}} go to Rwanda and {{journeys:collection=safari&country=Uganda}} to Uganda.",
    ],
    sections: [
      {
        h2: "Gorilla permit prices, October 2026",
        table: {
          caption: "Published rates for foreign non-residents, per person, from the Rwanda Development Board (visitrwandabookings.rdb.rw) and the Uganda Wildlife Authority. Checked 2026-10-01; confirm at booking, since both have changed before.",
          columns: ["Permit", "Price", "Time with the gorillas", "Notes"],
          rows: [
            ["Rwanda gorilla trek (Volcanoes NP)", "$1,500", "1 hour", "Groups of up to eight, one habituated family"],
            ["Uganda gorilla trek (Bwindi, Mgahinga)", "$800", "1 hour", "UWA has offered $600 in the low-season months of April, May and November"],
            ["Uganda gorilla habituation (Bwindi)", "$1,500", "Up to 4 hours", "Rising to $1,800 for treks from 1 January 2027 under UWA's 2026–2028 tariff; very few places"],
          ],
        },
        paras: [
          "Uganda now sells permits only through licensed Ugandan operators, and payment is due in full when the permit is booked, so the permit is usually the first thing secured and the rest of the trip is built around its date.",
        ],
      },
      {
        h2: "Side by side",
        table: {
          caption: "Permit prices are the national park authorities' published rates for foreign non-residents; confirm at booking, since both have changed before.",
          columns: ["", "Rwanda (Volcanoes NP)", "Uganda (Bwindi)"],
          rows: [
            ["Gorilla permit", "$1,500 per trek", "$800 per trek"],
            ["Getting there", "About 3 hours by road from Kigali", "Light aircraft to a Bwindi airstrip, or 4 to 5 hours by road from Kigali to southern Bwindi"],
            ["The trek", "Bamboo and volcano slopes; often 1 to 4 hours round trip", "Dense, steep forest; can run 2 to 6 hours or more"],
            ["Other primates", "Golden monkeys; chimpanzees in Nyungwe, a long drive south", "Chimpanzees in Kibale, the strongest chimp tracking in Africa"],
            ["Pairs well with", "A Tanzania or Kenya safari, via Kigali", "Queen Elizabeth NP and Murchison Falls within Uganda"],
            ["Minimum age", "15", "15"],
          ],
        },
        paras: [
          "Neither trek is technical, but both can be hard. Porters are available at the trailhead for a modest fee and are worth hiring even if you do not need one: the fee goes to the communities around the park, and a steadying hand on a wet slope is worth a great deal.",
        ],
      },
      {
        h2: "Which one, for whom",
        list: [
          "Four or five days, gorillas as an add-on to an East Africa safari: Rwanda. The Kigali connection makes it simple.",
          "A week or more, and the primates are the point: Uganda, with Bwindi and Kibale together.",
          "Two treks rather than one: either works, but the second trek costs $800 in Uganda and $1,500 in Rwanda.",
          "Fitness is a real concern: Rwanda, where rangers can often assign a nearer family on request. It is a request, not a promise.",
          "Honeymoon or a milestone: Rwanda's lodges are the reason, and they are worth it.",
        ],
      },
      {
        h2: "When to go",
        paras: [
          "Gorillas are seen year-round in both countries. The drier months, roughly June to September and December to February, make trails less slippery and are the most requested, so permits for those months go early. The rainy months are wetter underfoot but quieter, and the forest is at its greenest. Permits are released in limited numbers per family per day, which is why a gorilla trek is best booked before the rest of the trip is designed around it.",
        ],
      },
    ],
    evidence: {
      h2: "The Rwanda properties in the atlas",
      note:
        "The Rwandan lodges and hotels on file from the supplier feed, smallest first. Each links to its own page with the benefits a booking through us carries.",
      query: "country=Rwanda",
      sort: "smallest",
      limit: 10,
    },
    faqs: [
      {
        q: "Is the $1,500 Rwanda permit worth it over Uganda's $800?",
        a: "If your time is short, usually yes: the shorter transfer and simpler logistics can save a full day, which on a luxury trip is worth more than the difference. If you have a week and want the primates to be the center of the trip, Uganda gives more for the money.",
      },
      {
        q: "How close do you get?",
        a: "The rule is seven meters, but the gorillas have not read it. Families often move past and around the group, and rangers manage the distance. The hour is timed from when you reach them, not from the trailhead.",
      },
      {
        q: "What is the habituation experience in Uganda?",
        a: "A four-hour visit with a gorilla family still being habituated to people, alongside the researchers and trackers doing that work, offered in Bwindi's southern sector. It costs $1,500, rising to $1,800 from 1 January 2027, against $800 for a standard permit, and has very few places, and for many travelers it is the most memorable day of the trip.",
      },
    ],
    related: [
      { href: "/journeys/safari", label: "Every safari itinerary in the atlas, day by day" },
      { href: "/answers/which-safari-operator-should-you-book", label: "Which operator to book it through" },
      { href: "/answers/botswana-vs-kenya-vs-south-africa-first-safari", label: "The savannah half of the trip" },
      { href: "/hotels/rwanda", label: "Every Rwandan property in the atlas" },
    ],
  },
];
