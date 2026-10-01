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
    capsule:
      "No. For luxury hotels, cruises and villas you pay the same published rate, the supplier pays the advisor a commission out of its marketing budget, and the advisor's programs add benefits on top — upgrade priority, daily breakfast and property credits typically worth $100 or more a night. Complex custom itineraries are the exception, where a planning fee is normal.",
    answer: [
      "For luxury hotels, cruises and villas: no — in most cases you pay the same published rate you'd find yourself, the supplier pays the advisor a commission from its marketing budget, and the advisor's programs add benefits on top. At the {{collection:hotel}} hotels in our atlas, an advisor booking layers upgrade priority, daily breakfast, and property credits (typically $100+) onto the hotel's own flexible rate — value the DIY booking simply doesn't receive. On expedition cruises and villas the rate parity works the same way.",
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
        q: "How does the advisor relationship work?",
        a: "The Guide (our AI concierge) helps you explore the atlas — {{collection:hotel}} hotels, {{collection:cruise}} expedition sailings, {{collection:villa}} villas — and a human advisor takes over for pricing, program benefits, and the booking itself. Ask The Guide anything; it will tell you when a human should take the wheel.",
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
    capsule:
      "A full circumnavigation runs 110–180 days and is sold by roughly a dozen lines, from Princess and Holland America at the accessible end through Viking and Oceania in the middle to Regent, Silversea, Seabourn and Crystal at the top. Most guests sail a 15–60 day segment instead. Book 18–24 months ahead; the best cabins go at launch.",
    answer: [
      "Our world-cruise atlas currently tracks {{collection:worldcruise}} world cruises and grand voyages across 13 lines — Oceania, Azamara, Regent, Viking, Crystal, Silversea, Seabourn, Holland America, Princess, Explora, Cunard, Windstar and Lindblad. Full circumnavigations run roughly 110–180 days (the current longest in our data: Oceania Vista's 245-day Epic Global Adventure); most lines also sell them in 15–60 day segments, which is how the majority of guests actually experience them.",
      "Money, honestly: entry-level full world cruises start around $40,000–$60,000 per person (Princess, Holland America, mainstream Cunard cabins); the premium tier (Oceania, Viking, Azamara) runs roughly $60,000–$100,000; and the luxury all-inclusives (Regent, Silversea, Seabourn, Crystal, Explora) begin near $100,000 and climb past $400,000 in top suites. Book 12–24 months out — the best cabins on marquee sailings sell on opening day, with past-guest waitlists ahead of you.",
    ],
    sections: [
      {
        h2: "Which line fits which circumnavigator",
        table: {
          caption: "From the {{collection:worldcruise}} world-cruise departures in our atlas.",
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
      { href: "/atlas/worldcruise", label: "Browse all {{collection:worldcruise}} voyages in the world-cruise atlas" },
      { href: "/journeys/worldcruise", label: "Every world cruise itinerary, day by day" },
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
    capsule:
      "The luxury rail canon: the Venice Simplon-Orient-Express for the definitive one-night journey, La Dolce Vita Orient Express for Italy, Belmond's Royal Scotsman for the Highlands and Andean Explorer for Peru, Rovos Rail and the Blue Train in South Africa, Japan's ballot-only Seven Stars and Shiki-shima, and the Glacier Express Excellence Class through the Alps.",
    answer: [
      "The canon, ranked by how often they reward the fare: the Venice Simplon-Orient-Express (Belmond) remains the definitive one-night masterpiece — Paris/London to Venice in 1920s carriages, the single best first luxury train; La Dolce Vita Orient Express is the new Italian counterpoint, running Rome-based loops in midcentury-modern style; Belmond's Royal Scotsman (Highlands, whisky, 40 guests) and Andean Explorer (Cusco–Titicaca–Arequipa, the highest luxury sleeper on earth) own their landscapes; and Rocky Mountaineer (daylight-only, hotel nights) is the right answer for the Canadian Rockies and travelers who want scenery without sleeping on rails.",
      "Our rail atlas tracks {{collection:train}} luxury rail journeys and rail-centered itineraries worldwide — including Japan by rail (where the ultra-exclusive Seven Stars and Shiki-shima run by ballot), the Alps by Glacier Express Excellence Class, and multi-country itineraries that thread trains into a larger trip, which is how we most often deploy them.",
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
      { href: "/atlas/train", label: "All {{collection:train}} rail journeys in the rail atlas" },
      { href: "/journeys/train", label: "Every rail itinerary, with what each fare includes" },
      { href: "/answers/world-cruises-compared", label: "The sea-going equivalent: world cruises compared" },
    ],
  },

  {
    slug: "yacht-charter-vs-luxury-yacht-cruise",
    category: "Yachts",
    question: "When should you charter a yacht vs. book a luxury yacht cruise?",
    title: "Yacht Charter vs. Luxury Yacht Cruise (Four Seasons, Ritz-Carlton, Aman)",
    description:
      "Private crewed charter vs. the new hotel-brand yachts — Four Seasons Yachts, Ritz-Carlton Yacht Collection, Aman at sea, Orient Express Corinthian — with a worked cost example per person and for the whole boat, control, and which fits your group.",
    updated: "2026-10-01",
    capsule:
      "Book a hotel-brand yacht cruise — Ritz-Carlton, Four Seasons, Orient Express — when you want yacht life without yacht responsibility, at roughly $1,500–$4,000 a night for two. Charter privately when the group is the point: a crewed six-cabin yacht runs $150,000–$400,000 a week plus about 30–35% in expenses, and the itinerary, chef and guest list answer to you.",
    answer: [
      "Book the yacht cruise when you want yacht life without yacht responsibility: the hotel-brand fleet — Ritz-Carlton Yacht Collection, Four Seasons Yachts, Orient Express's Corinthian, and Aman's forthcoming Amanclipper era — sells suite-level cabins from roughly $1,500–$4,000 per night for two, with restaurants, spas, marinas off the stern and zero decisions required. Our yacht atlas tracks {{collection:yacht}} sailings across these four brands. Charter privately when the group is the point: a crewed 6-cabin yacht for 8–12 guests runs about $150,000–$400,000+ per week plus roughly 30–35% for fuel, food, dockage and gratuity (the APA) — which works out at roughly two and a half to four times the per-person cost of a suite on a brand yacht, and what the difference buys is that the itinerary, the chef and the guest list answer to you.",
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
        h2: "The same week, priced both ways",
        table: {
          caption: "A worked example for ten guests (five couples), seven nights in the Mediterranean in July, using the midpoints of the ranges on this page. Illustrative, not a quote: rates move by season, yacht and suite category.",
          columns: ["", "Brand yacht cruise (5 suites)", "Private charter (50-meter, 5 cabins)"],
          rows: [
            ["How it is priced", "Per suite, per night, for two", "Whole boat, per week"],
            ["Base price", "5 suites × $2,500 a night × 7 nights = $87,500", "$250,000 charter fee"],
            ["Food, drink, fuel, port fees", "Included in the fare", "APA at 30%: $75,000, spent at cost and reconciled at the end"],
            ["Crew gratuity", "Included on most brand yachts", "About 15% of the base: $37,500"],
            ["VAT", "Included", "Charged on the charter fee in most Mediterranean countries; budget for it"],
            ["Week total, before VAT", "About $87,500", "About $362,500"],
            ["Per person, per night", "About $1,250", "About $5,200"],
            ["Per person, per night, top-category suites at $4,000", "About $2,000", "About $5,200"],
          ],
        },
        paras: [
          "On these numbers the charter costs about two and a half to four times as much per person. The gap narrows as the group grows, because the charter price is for the boat, not the head count: twelve guests on the same yacht bring it down to about $4,300 each per night. It narrows further against a brand yacht's largest suites. What the premium buys is the route, the timing, the menu and the guest list.",
        ],
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
        a: "A quality 50-meter at $250,000 base + 30% APA + 15% crew gratuity ≈ $362,500 before VAT — about $5,200 per person per night. The same five couples in good suites on a brand yacht pay about $1,250–$2,000 per person per night, all in. The charter costs roughly two and a half to four times as much; the premium buys control, not just space.",
      },
      {
        q: "Med or Caribbean, and when?",
        a: "Med June–September (book winter for August), Caribbean December–April (book by early fall for festive weeks). The brand yachts reposition seasonally exactly like charter fleets — our atlas shows both seasons' sailings.",
      },
      {
        q: "Are the brand yachts good for non-cruise people?",
        a: "They're specifically engineered for cruise-skeptics: no announcements, no lido-deck contests, marinas that open from the stern, port-intensive itineraries. If the objection is 'I don't do cruises,' this is the counter-argument in steel.",
      },
    ],
    related: [
      { href: "/atlas/yacht", label: "All {{collection:yacht}} brand-yacht sailings in the yacht atlas" },
      { href: "/journeys/yacht", label: "Every yacht itinerary, with its departures" },
      { href: "/answers/world-cruises-compared", label: "Longer at sea: world cruises compared" },
      { href: "/answers/best-caribbean-villas-for-12-guests", label: "The land-based alternative for big groups" },
    ],
  },
  {
    slug: "rocky-mountaineer-vs-via-rail-canadian",
    category: "Rails",
    question: "Rocky Mountaineer or VIA Rail's Canadian: which Canadian train should you take?",
    title: "Rocky Mountaineer vs. VIA Rail Canadian: Which Train Through the Rockies",
    description:
      "Daylight-only luxury against a four-night transcontinental sleeper: how Rocky Mountaineer and VIA Rail's Canadian differ, who each suits, and how to build them into a trip, from the {{journeys:collection=train&country=Canada}} Canadian rail itineraries in our atlas.",
    updated: "2026-10-01",
    capsule:
      "Take Rocky Mountaineer to see the Rockies in comfort: it runs only in daylight from April to October, stops overnight in hotels, and its two-day routes cost from about CA$2,300 per person in SilverLeaf in 2026. Take VIA Rail's Canadian for the journey itself: four nights aboard between Toronto and Vancouver, year-round, from about CA$1,000 for a Sleeper Plus berth to CA$5,500 and up in Prestige.",
    answer: [
      "They answer different questions. Rocky Mountaineer is a sightseeing train. It travels only by day so you never pass the scenery in the dark, puts you in a hotel each night, and concentrates on the mountain stretches between Vancouver, Jasper, Banff and Lake Louise. Its GoldLeaf service has a two-level glass-dome coach with a dining room below. It runs roughly April to October.",
      "VIA Rail's Canadian is a working transcontinental train that happens to be one of the great rail journeys. It crosses from Toronto to Vancouver over four nights, through the lakes and forests of northern Ontario, the prairies and then the Rockies, and it runs all year, including snow season. Prestige class adds a larger cabin with its own shower and a dedicated attendant. Of the {{journeys:collection=train&country=Canada}} Canadian rail itineraries in our atlas, {{journeys:collection=train&vessel=Rocky Mountaineer}} are built on Rocky Mountaineer and {{journeys:collection=train&vessel=VIA Rail Canadian}} on the Canadian.",
    ],
    sections: [
      {
        h2: "Side by side",
        table: {
          columns: ["", "Rocky Mountaineer", "VIA Rail Canadian"],
          rows: [
            ["What it is", "Daylight sightseeing train", "Overnight transcontinental sleeper"],
            ["Nights", "In hotels along the route", "Aboard, in a private cabin"],
            ["Route", "Vancouver, Kamloops, Jasper, Banff, Lake Louise", "Toronto to Vancouver, via Winnipeg, Edmonton and Jasper"],
            ["Season", "About April to October", "Year-round"],
            ["Top service", "GoldLeaf: bilevel glass dome, dining room below", "Prestige: larger cabin with private shower"],
            ["Best for", "The mountains, with good hotels and no sleeping aboard", "The whole country, and travelers who love trains for their own sake"],
          ],
        },
      },
      {
        h2: "2026 fares and schedules by class",
        table: {
          caption: "Lowest published 2026 fares per person, one way, in Canadian dollars before tax, from Rocky Mountaineer (rockymountaineer.com) and VIA Rail (viarail.ca). Checked 2026-10-01. Fares rise from spring to a September peak on Rocky Mountaineer and peak in summer on the Canadian; confirm on a specific date, and expect 2027 fares to be higher.",
          columns: ["Train and class", "Route", "Time aboard", "Runs", "2026 fare from"],
          rows: [
            ["Rocky Mountaineer SilverLeaf", "Vancouver–Banff (First Passage to the West) or Vancouver–Jasper (Journey through the Clouds)", "2 days, overnight in a Kamloops hotel", "Mid-April to mid-October, several departures a week", "About CA$2,300 (April) to CA$3,000 (September)"],
            ["Rocky Mountaineer GoldLeaf", "The same two routes", "2 days, overnight in a Kamloops hotel", "Mid-April to mid-October", "About CA$800 to CA$1,100 more than SilverLeaf; CA$3,100 (April) to CA$4,000 (September)"],
            ["Rocky Mountaineer GoldLeaf", "North Vancouver–Whistler–Quesnel–Jasper (Rainforest to Gold Rush)", "3 days, hotels in Quesnel and Whistler", "Spring to October, fewer departures", "About CA$4,500 to CA$5,000, GoldLeaf only"],
            ["VIA Canadian Sleeper Plus", "Toronto–Vancouver via Winnipeg, Edmonton and Jasper", "4 nights in a berth or private cabin", "Year-round, twice a week each way most of the year, on a separate winter timetable", "About CA$1,000 (spring) to CA$1,350 (summer) for a berth; private cabins cost more"],
            ["VIA Canadian Prestige", "Toronto–Vancouver", "4 nights in the largest cabin, with private shower and attendant", "Year-round", "About CA$5,500 (spring) to CA$7,200 (summer)"],
          ],
        },
        paras: [
          "Read the two prices differently. A Rocky Mountaineer fare covers two days of sightseeing, meals aboard and one hotel night; the hotels at either end are extra. A Canadian fare covers four nights aboard, and in Sleeper Plus and Prestige all meals in the dining car, so per night the Canadian is the cheaper of the two at every level below Prestige.",
        ],
      },
      {
        h2: "How the two fit into a trip",
        paras: [
          "Most Rocky Mountaineer trips are built as circle tours: the train one way, a drive or a flight back, and nights at Jasper, Banff or Lake Louise in between. That is where a Canadian rail trip is really won or lost, because the hotels at the far end are part of the experience rather than somewhere to sleep. The Canadian works best as the spine of a longer trip, often with a few days in Toronto at the start and Vancouver or Vancouver Island at the end.",
          "The two also combine well. A popular shape is the Canadian from Toronto to Jasper, then Rocky Mountaineer from Jasper on to Vancouver, which gives you both the sleeper experience and the daylight mountain stretch.",
        ],
      },
    ],
    faqs: [
      {
        q: "Is GoldLeaf worth the premium over SilverLeaf?",
        a: "For most people on a once-only trip, yes. The upper-deck dome gives the full view overhead, and meals are served in a separate dining room rather than at your seat. SilverLeaf is still very good, with a single-level dome coach.",
      },
      {
        q: "Does the Canadian run on time?",
        a: "Often not. It shares track with freight trains, which have priority, so delays of hours are common. That is part of the character of the trip, but it means you should not book a tight connection at the far end.",
      },
      {
        q: "Can I see the Rockies in winter by train?",
        a: "Only on the Canadian. Rocky Mountaineer does not run in winter, while the Canadian runs through snow season at reduced frequency, and a winter crossing of the Rockies is one of the most beautiful rail journeys anywhere.",
      },
    ],
    related: [
      { href: "/journeys/train", label: "Every rail itinerary in the atlas, day by day" },
      { href: "/answers/best-luxury-train-journeys", label: "The great luxury trains of the world" },
      { href: "/hotels/canada", label: "Every Canadian property in the atlas" },
    ],
  },

  {
    slug: "world-cruise-segments-explained",
    category: "Voyages",
    question: "Do you have to do a whole world cruise, or can you book a segment?",
    title: "World Cruise Segments: How to Sail Part of a World Voyage",
    description:
      "How world cruise segments work, what you give up against the full voyage, and which lines sell them, across the {{journeys:collection=worldcruise}} long voyages in our atlas.",
    updated: "2026-10-01",
    capsule:
      "You do not have to sail the whole voyage. Almost every world cruise is also sold in segments of roughly two to ten weeks, each starting and ending in a port with good air connections: in 2027, Cunard's Queen Victoria sails Sydney to Southampton in 65 nights of a 110-night world voyage. You get the same ship and itinerary for that stretch, but usually not the full-voyage extras, such as included air, onboard credit and events kept for full-world guests.",
    answer: [
      "A world cruise is usually a single voyage of around three to six months, but lines sell it in pieces too: Sydney to Singapore, Cape Town to Lisbon, Miami to Los Angeles through the Panama Canal. Each segment is a normal cruise in its own right, and it is often the best way to sail the most interesting part of a world voyage without giving up four months.",
      "What changes is the package. Full-world guests are the lines' most valued passengers and usually get the most generous terms: included business-class air on some lines, larger onboard credits, private events ashore and gifts along the way. Segment guests share the ship and the ports but rarely get the full set. Our atlas holds {{journeys:collection=worldcruise}} long voyages; {{journeys:collection=worldcruise&daysMin=100}} of them run for 100 days or more.",
    ],
    sections: [
      {
        h2: "Full voyage vs. segment",
        table: {
          columns: ["", "Full world voyage", "Segment"],
          rows: [
            ["Length", "Often 100 to 180 days", "Usually 2 to 6 weeks"],
            ["Cost", "Highest total, lowest per night on many lines", "Lower total, often a higher rate per night"],
            ["Extras", "The full package: air, credits, events ashore", "Usually standard cruise terms"],
            ["Suite choice", "Booked early; the best suites go first", "What remains around full-world bookings"],
            ["Best for", "Retirees and long-sabbatical travelers", "Anyone who wants one region done properly"],
          ],
        },
        paras: [
          "Suite availability is the practical catch. Full-world guests book early and hold their suites for the whole voyage, so the best categories on a popular segment can be unavailable even when the segment itself has space. If a specific suite matters, it is worth asking early whether it is being held for the full voyage.",
        ],
      },
      {
        h2: "2027 world cruise segments",
        table: {
          caption: "2027 world voyages and the segments each line sells from them, from the sailings in our world-cruise atlas (supplier feed, checked 2026-10-01). Ports counts every port and scenic passage on the route, including embarkation and disembarkation. The atlas holds voyages of about 45 nights and longer, so shorter segments sold by some lines are not listed here.",
          columns: ["Line and ship", "Voyage or segment", "2027 dates", "Nights", "Ports", "Along the way"],
          rows: [
            ["Cunard, Queen Victoria", "Full world voyage, Southampton round trip", "10 Jan – 30 Apr", "110", "32", "New York, Fiji, Manila, Durban"],
            ["Cunard, Queen Victoria", "Southampton to Sydney", "10 Jan – 24 Feb", "45", "12", "New York, Hawaii, New Caledonia"],
            ["Cunard, Queen Victoria", "Sydney to Southampton", "24 Feb – 30 Apr", "65", "22", "Great Barrier Reef, Manila, Singapore, Cape Town"],
            ["Cunard, Queen Victoria", "Hong Kong to Southampton", "15 Mar – 30 Apr", "46", "15", "Vietnam, Mauritius, Cape Town, Madeira"],
            ["Seabourn, Seabourn Quest", "Full world cruise, Miami round trip", "5 Jan – 30 May", "145", "66", "Panama Canal, New Zealand, Australia"],
            ["Seabourn, Seabourn Quest", "Miami to Sydney", "5 Jan – 9 Mar", "63", "30", "Panama Canal, Marquesas, Cook Islands, New Zealand"],
            ["Seabourn, Seabourn Quest", "Sydney to Long Beach", "9 Mar – 11 May", "63", "31", "Tasmania, Western Australia, Cairns, Fiji, Hawaii"],
            ["Seabourn, Seabourn Quest", "Brisbane to Miami", "15 Apr – 30 May", "45", "19", "Norfolk Island, Fiji, Mexico, Panama Canal"],
            ["Holland America, Volendam", "Grand World Voyage, Fort Lauderdale round trip", "5 Jan – 15 May", "130", "53", "Panama Canal, Australia, Mauritius, Canary Islands"],
            ["Holland America, Volendam", "Cape Town to Fort Lauderdale", "22 Mar – 15 May", "54", "24", "Namibia, St Helena, Cape Verde, Lisbon, Bordeaux, Copenhagen"],
            ["Azamara, Azamara Quest", "Full world cruise, San Francisco to Copenhagen", "5 Jan – 12 Jul", "188", "96", "Hawaii, Australia, Japan, Panama Canal"],
            ["Azamara, Azamara Quest", "San Francisco to Sydney", "5 Jan – 22 Feb", "48", "24", "Hawaii, American Samoa, New Zealand"],
            ["Azamara, Azamara Quest", "Hong Kong to London", "2 Apr – 28 Jun", "87", "48", "Taiwan, Japan, Vancouver, Cartagena"],
            ["Oceania Cruises, Vista", "Around the World in 180 Days, Miami to Southampton", "6 Jan – 5 Jul", "180", "107", "Australia, Manila, the Adriatic"],
            ["Oceania Cruises, Vista", "Papeete to Yokohama", "8 Feb – 11 Apr", "62", "36", "Huahine, Sydney, Jakarta, Shanghai"],
            ["Oceania Cruises, Vista", "Yokohama to Rome (Civitavecchia)", "11 Apr – 15 Jun", "65", "40", "Okinawa, Phuket, Jordan, Croatia"],
            ["Princess, Coral Princess", "World cruise, Fort Lauderdale to Los Angeles", "6 Jan – 15 May", "129", "61", "Cartagena, Vanuatu, Australia, Taiwan"],
            ["Princess, Coral Princess", "Los Angeles to Singapore", "21 Jan – 31 Mar", "69", "30", "Hawaii, Vanuatu, Brisbane, Hobart"],
            ["Princess, Coral Princess", "Singapore to Los Angeles", "31 Mar – 15 May", "45", "25", "Phuket, Vietnam, Osaka, Alaska"],
          ],
        },
        paras: [
          "Two patterns stand out. Segments start and end where long-haul flights are easy: Sydney, Hong Kong, Singapore, Cape Town, Los Angeles. And the same ship often sells overlapping pieces, such as Queen Victoria's Sydney to Southampton and Hong Kong to Southampton, so the end of a voyage can be joined at more than one point. Each voyage has its own page in the atlas with every port and departure.",
        ],
      },
      {
        h2: "Choosing a segment",
        list: [
          "Pick by region, then by season: the South Pacific and Australia leg of a January departure is usually the most requested.",
          "Look for segments that start and end in hubs, such as Sydney, Singapore, Dubai or Barcelona, so flights are simple.",
          "Two back-to-back segments often cost less than you would expect, and sometimes add perks, so price the combination.",
          "Ask whether any full-voyage events fall inside your dates; sometimes segment guests are invited too.",
        ],
      },
    ],
    faqs: [
      {
        q: "Which lines sell world cruise segments?",
        a: "Nearly all of them, including Cunard, Seabourn, Regent Seven Seas, Silversea, Oceania, Azamara, Holland America, Princess and Viking. The exact segments each year depend on the route, and they are released at the same time as the full voyage.",
      },
      {
        q: "Can I upgrade a segment into the full voyage later?",
        a: "Sometimes, if space allows, but the full-voyage package is usually priced for guests who booked it as such. If there is a real chance you will want the whole thing, ask for the full-voyage fare up front.",
      },
      {
        q: "Is a world cruise segment good for a first cruise?",
        a: "It can be, particularly on a smaller luxury ship. The ship is calm and settled into its long voyage, the guests are experienced and friendly, and the port days tend to be longer than on a typical short cruise.",
      },
    ],
    related: [
      { href: "/journeys/worldcruise", label: "Every world voyage in the atlas, with its ports" },
      { href: "/answers/world-cruises-compared", label: "The world cruises themselves, compared" },
      { href: "/answers/do-travel-advisors-cost-more", label: "Do travel advisors cost more?" },
    ],
  },

  {
    slug: "private-jet-journeys-explained",
    category: "Planning",
    question: "What is a private jet journey, and is it worth it?",
    title: "Private Jet Journeys Explained: Who Runs Them and Who They Suit",
    description:
      "How escorted private jet journeys work, who operates them, what they cost and who they are best for, across the {{journeys:collection=jet}} jet itineraries in our atlas.",
    updated: "2026-10-01",
    capsule:
      "A private jet journey is an escorted trip around the world or a region on a chartered, reconfigured aircraft with roughly 40 to 80 guests, lie-flat seats, a dedicated crew and expert lecturers. It removes every airport queue and connection. For 2027, departures cost from about $125,000 per person with National Geographic, $170,000–$190,000 for Abercrombie & Kent's round-the-world trips and $167,000–$235,000 with Four Seasons. They suit travelers who want many far-apart places in two to four weeks.",
    answer: [
      "The idea is simple: the best places on earth are rarely next to each other, and commercial flying between them is what wears a trip down. On a private jet journey the aircraft is yours for the whole trip. You arrive at a private terminal, board the same plane with the same crew each time, and step out in the next country while your luggage goes ahead to the hotel. On the ground, the stays are at the best hotels in each place, with a small team of guides and, on most trips, a physician traveling with the group.",
      "A few operators run most of these trips. TCS World Travel is the longest-established and operates the Four Seasons Private Jet, and Abercrombie & Kent, Remote Lands and National Geographic run their own departures. Our atlas holds {{journeys:collection=jet}} jet itineraries; the typical trip runs about two to three weeks, and {{journeys:collection=jet&daysMin=21}} of them last three weeks or more.",
    ],
    sections: [
      {
        h2: "2026–27 prices and routes, operator by operator",
        table: {
          caption: "Published from-prices per person, sharing, from each operator's announcements of its 2027 departures (fourseasons.com, abercrombiekent.com, nationalgeographic.com). Checked 2026-10-01. Solo travelers pay a supplement, and prices for later departures are often higher.",
          columns: ["Operator", "Aircraft and group", "Departure", "2027 dates", "Days", "From, per person"],
          rows: [
            ["National Geographic", "Boeing 757, up to 75 guests", "Around the World by Private Jet", "1–26 January; 30 March–24 April", "26", "$124,995"],
            ["Abercrombie & Kent", "Boeing 757, 50 lie-flat seats", "Wild Wonders: Around the World by Private Jet", "4–25 February", "22", "$169,500"],
            ["Abercrombie & Kent", "Boeing 757, 50 lie-flat seats", "Epic Islands and Landscapes: Around the World by Private Jet", "1–26 May", "26", "$189,500"],
            ["Abercrombie & Kent", "Boeing 757, 50 lie-flat seats", "Hidden Horizons, escorted by founder Geoffrey Kent", "14 October–8 November", "26", "About $300,000"],
            ["Four Seasons (operated by TCS World Travel)", "Airbus A321neo-LR, 48 guests", "Asia Unveiled", "11–26 February", "16", "$167,000"],
            ["Four Seasons (operated by TCS World Travel)", "Airbus A321neo-LR, 48 guests", "International Intrigue", "3–23 March", "21", "$230,000"],
            ["Four Seasons (operated by TCS World Travel)", "Airbus A321neo-LR, 48 guests", "New World Icons", "26 March–14 April", "20", "$219,000"],
            ["Four Seasons (operated by TCS World Travel)", "Airbus A321neo-LR, 48 guests", "Timeless Encounters", "15 April–6 May", "22", "$235,000"],
          ],
        },
        paras: [
          "Per day, that is roughly $4,800 with National Geographic, $7,300 to $7,700 with Abercrombie & Kent and $10,000 to $11,000 with Four Seasons. The spread buys fewer guests per aircraft, the hotels on the ground (Four Seasons stays in its own properties wherever it has one) and, with National Geographic, an expert team built around its photographers and scientists rather than around the hotels. Regional journeys, such as Abercrombie & Kent's India or Italy by private jet and Remote Lands' Asian routes, run 10 to 14 days, with prices to match.",
        ],
      },
      {
        h2: "What is included, and what is not",
        table: {
          columns: ["Usually included", "Usually not included"],
          rows: [
            ["All flights on the private jet", "Flights to the starting city and home from the last"],
            ["The best hotel in each stop, often in suites", "Some premium spa treatments and personal extras"],
            ["Nearly all meals, drinks and excursions", "Travel insurance"],
            ["Tour director, guides, lecturers and a physician", "Gratuities, on some operators"],
            ["Luggage handled from start to finish", ""],
          ],
        },
        paras: [
          "Because nearly everything is included, the price looks higher than it is when set against building the same trip privately. It is still a large sum, and it is worth comparing it honestly with a private itinerary on commercial business class, which suits some travelers better.",
        ],
      },
      {
        h2: "Who it suits, and who it does not",
        list: [
          "Suits: travelers with limited time who want six or eight countries in one trip without a single connection.",
          "Suits: couples and solo travelers who enjoy a well-traveled group and good lecturers.",
          "Suits less: anyone who wants long, slow stays in one place, since most stops are two or three nights.",
          "Suits less: families with young children, as these trips are designed for adults and the pace is full.",
        ],
      },
    ],
    faqs: [
      {
        q: "How big is the group?",
        a: "Usually around 40 to 80 guests, depending on the aircraft. On the ground the group often splits into smaller parties for excursions, and there is always a choice of activities at each stop.",
      },
      {
        q: "What does it cost?",
        a: "For 2027, departures start at about $125,000 per person with National Geographic and $170,000 with Abercrombie & Kent, and run $167,000 to $235,000 with Four Seasons, with a supplement for solo travelers. The price includes almost everything, so the fair comparison is with a fully private itinerary of the same length and standard.",
      },
      {
        q: "How far ahead should I book?",
        a: "A year or more for the most popular routes, since each departure has a small number of seats and the same guests often return.",
      },
    ],
    related: [
      { href: "/journeys/jet", label: "Every private jet itinerary in the atlas" },
      { href: "/answers/world-cruises-compared", label: "The slower way round the world" },
      { href: "/answers/do-travel-advisors-cost-more", label: "Do travel advisors cost more?" },
    ],
  },
];
