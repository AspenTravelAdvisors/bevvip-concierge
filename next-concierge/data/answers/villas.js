// Answer pages — villas. All figures queried directly from
// data/villas-of-distinction.json (3,902 villas) on the `updated` date;
// nightly rates are supplier from-rates in USD and move with season.

const UPDATED = "2026-07-21";

export const villaAnswers = [
  {
    slug: "best-caribbean-villas-for-12-guests",
    category: "Villas",
    question: "What are the best luxury villas in the Caribbean for 12+ guests?",
    title: "Best Caribbean Villas for 12+ Guests",
    description:
      "371 Caribbean villas sleeping 12 or more, from $458/night — St. Martin, St. Lucia, Barbados, BVI and beyond, with real from-rates and how to choose an island for a big group.",
    updated: UPDATED,
    answer: [
      "Our Villa Atlas currently holds 371 Caribbean villas that sleep 12 or more guests, with from-rates starting under $500 a night — proof that a villa for a dozen people routinely costs less per bedroom than two hotel rooms. The islands with the deepest big-group inventory are St. Martin (especially the Terres Basses estate zone), Barbados' west coast, St. Lucia's Cap Estate, the Dominican Republic's resort peninsulas, and the British Virgin Islands.",
      "For groups of twelve, the honest starting shortlist from the data: Tamarind Villa in St. Lucia (sleeps 14, 7 bedrooms, from $499/night), La Maison L'Ile in St. Martin (sleeps 12, from $458), Loblolly in the BVI (sleeps 14, from $728), Casabella in Barbados (sleeps 12, from $750), and Alizee in St. Martin, which stretches to 18 guests from $930. All are staffed or serviced, and all book through your advisor with the supplier's concierge included.",
    ],
    sections: [
      {
        h2: "The value math nobody runs",
        paras: [
          "Twelve guests at a luxury Caribbean resort means six rooms at $800–$1,500 each in season — $4,800–$9,000 a night before breakfast. The villas above land between $458 and $1,000 a night total, with full kitchens, pools, and the option of a private chef at roughly $150–$300 a day plus groceries. Even tripling the villa budget for a marquee estate leaves margin for a chef, a boat day and a driver.",
          "What you trade: the resort's restaurants-and-towel-boy infrastructure. What you gain: one table big enough for everyone, nobody negotiating pool chairs, and grandparents with their own wing.",
        ],
      },
      {
        h2: "Big-group villas worth knowing, from the Atlas",
        table: {
          caption: "Supplier from-rates (USD/night, whole villa) as of July 2026 — seasonal; holiday weeks price higher.",
          columns: ["Villa", "Island", "Sleeps", "Bedrooms", "From"],
          rows: [
            ["La Maison L'Ile", "St. Martin", "12", "6", "$458"],
            ["Tamarind Villa (Cap Estate)", "St. Lucia", "14", "7", "$499"],
            ["Colibri Cottage", "St. Lucia", "12", "6", "$695"],
            ["Loblolly", "British Virgin Islands", "14", "6", "$728"],
            ["Casabella", "Barbados", "12", "6", "$750"],
            ["Villa Nirvana, Terres Basses", "St. Martin", "12", "6", "$885"],
            ["Alizee", "St. Martin", "18", "7", "$930"],
            ["Tortuga B19", "Dominican Republic", "12", "5", "$1,000"],
          ],
        },
        paras: [
          "Above this tier, the Caribbean scales almost without limit — multi-villa compounds like Grand Cayman's Black Urchin estates sleep 40–88 for full family-reunion takeovers. If the group is 20+, we assemble compounds rather than single houses.",
        ],
      },
      {
        h2: "Picking the island for a group of twelve",
        list: [
          "St. Martin — deepest villa inventory in the region, two nations of restaurants, easy nonstops. Default answer.",
          "Barbados — polished staff culture (most villas come cooked-for), calm west-coast swimming, direct flights from both coasts and London.",
          "St. Lucia — drama (Pitons, rainforest) at the friendliest big-villa pricing; roads are winding, plan drivers.",
          "BVI — sailing-centric groups; pair the villa with a day-charter catamaran.",
          "Turks & Caicos / Grand Cayman — the splurge tier: Grace Bay/Seven Mile beachfront estates at $3,000–$28,000/night for milestone events.",
        ],
      },
    ],
    faqs: [
      {
        q: "Do these villas come with staff?",
        a: "Nearly all include housekeeping and a villa manager; Barbados and St. Lucia estates often include cooks. Private chefs, provisioning, boat days and spa calls are arranged through the villa concierge your booking includes.",
      },
      {
        q: "When should a 12-person group book?",
        a: "For February/March or holiday weeks: 9–12 months ahead — big villas are scarcer than hotel suites. Summer and late spring can book 3–5 months out at 25–40% below winter rates.",
      },
      {
        q: "How do deposits and payments work for groups?",
        a: "Typically 25–50% to hold, balance 60–90 days out, one contract — your advisor runs the split-payment diplomacy so the group chat doesn't have to.",
      },
    ],
    related: [
      { href: "/atlas/villa", label: "Search all 371 Caribbean 12+ villas on the map" },
      { href: "/answers/villa-vs-resort-for-a-family-of-10", label: "Villa vs. resort for a family of 10 — the cost math" },
      { href: "/answers/best-villas-under-2000-that-sleep-8", label: "Best villas under $2,000 that sleep 8+" },
    ],
  },

  {
    slug: "villa-vs-resort-for-a-family-of-10",
    category: "Villas",
    question: "Villa or five-star resort for a family of 10 — which actually costs less?",
    title: "Villa vs. Five-Star Resort for a Family of 10: The Real Cost Math",
    description:
      "Running the real numbers on a 10-person family trip: five hotel rooms vs. one staffed villa, using live from-rates from 3,902 tracked villas — plus when the resort is still worth it.",
    updated: UPDATED,
    answer: [
      "For ten people, the villa usually wins the arithmetic by a wide margin: five luxury-resort rooms at $700–$1,200 each run $3,500–$6,000 a night, while our Atlas holds 1,541 villas that sleep eight or more for under $2,000 a night total — hundreds of them under $1,000. Add a private chef (roughly $200–$300/day plus groceries) and the villa still typically lands at a third to a half of the resort bill, with a kitchen, laundry, and no one sleeping on a rollaway.",
      "The resort wins on different axes: kids' clubs and instant friends for children, restaurants without decisions, service that materializes without being organized, and — non-trivially — nobody in the family is the de facto innkeeper. The honest answer is usually a split trip: villa for the together-time, two resort nights at the end for the towel-boy decompression.",
    ],
    sections: [
      {
        h2: "The worked example",
        table: {
          caption: "Seven nights, family of 10, high-season Caribbean, real from-rates from the Atlas (July 2026).",
          columns: ["", "Five-star resort (5 rooms)", "Staffed villa (6BR)"],
          rows: [
            ["Lodging", "$3,500–6,000/night → $24,500–42,000", "$750–1,500/night → $5,250–10,500"],
            ["Breakfast for 10", "$400–600/day → ~$3,500", "In the kitchen"],
            ["Chef + provisioning", "—", "~$250/day + ~$1,500 groceries → ~$3,250"],
            ["Dinners out (half the nights)", "Included in resort life? No — add $2,500+", "$1,500 (chef covers rest)"],
            ["Service/staff gratuities", "Resort fees + tips ~$1,500", "Villa staff gratuity ~$700–1,000"],
            ["Realistic week total", "$30,000–50,000", "$11,500–16,500"],
          ],
        },
        paras: [
          "Even generously salting the villa column with a boat day and a babysitter, the gap doesn't close. Where it does close: peak-festive weeks (villa minimums spike), groups that would have shared fewer hotel rooms, and destinations where five-star rates are soft (Mexico all-inclusives, shoulder-season Asia).",
        ],
      },
      {
        h2: "Choose by family, not by spreadsheet",
        list: [
          "Choose the villa when: three generations, toddlers with nap schedules, dietary chaos, a reunion where the point is one long table, or any group allergic to 7pm restaurant negotiations for ten.",
          "Choose the resort when: teenagers who need a scene, parents who want a real vacation from logistics, water-sports/kids-club dependence, or a family that's never traveled together and needs escape hatches.",
          "Choose both when: the budget freed by the villa week funds two resort nights — the pattern our returning families settle into almost universally.",
        ],
      },
    ],
    faqs: [
      {
        q: "Doesn't someone have to run the villa?",
        a: "That's what the villa manager and your advisor's pre-arrival planning are for: chef hired, fridge stocked, boat booked and babysitters vetted before you land. The failure mode is booking a bare villa with no plan — which is a rental, not a villa holiday.",
      },
      {
        q: "What about connecting rooms or a resort residence instead?",
        a: "Resort residences (the 60 villas/residences properties in our Hotel Atlas — Forte Village, Rocco Forte Private Villas and kin) are exactly the hybrid: villa space with resort infrastructure. They price between the two columns and are the right answer for families who want both and will pay for it.",
      },
      {
        q: "Is a villa riskier — what if it's not as pictured?",
        a: "This is why the supplier matters. Our villa inventory is professionally managed and inspected (Villas of Distinction network), with local managers on call — not peer-to-peer listings. The advisor's job is knowing which houses photograph better than they live, and vice versa.",
      },
    ],
    related: [
      { href: "/answers/best-caribbean-villas-for-12-guests", label: "The Caribbean big-group shortlist with real rates" },
      { href: "/answers/best-villas-under-2000-that-sleep-8", label: "1,541 villas under $2,000 that sleep 8+" },
      { href: "/atlas/villa", label: "Search the Villa Atlas map" },
    ],
  },

  {
    slug: "best-villas-under-2000-that-sleep-8",
    category: "Villas",
    question: "What are the best private villas under $2,000/night that sleep 8+?",
    title: "Best Villas Under $2,000/Night That Sleep 8+",
    description:
      "1,541 villas under $2,000 a night sleeping eight or more — where they cluster (Colorado, Hawaii, Italy, Barbados, St. Martin) and how to pick well at this price point.",
    updated: UPDATED,
    answer: [
      "This is the sweetest spot in the villa market: our Atlas currently lists 1,541 villas that sleep eight or more with from-rates under $2,000 a night — which per-person, per-night puts a private staffed house below a mid-tier hotel room. The inventory clusters where you'd hope: Colorado ski country (200 villas — Vail, Beaver Creek, Breckenridge), Hawaii (189), Italy (112 — Tuscany and points south), Florida (108), France (93), and the Caribbean's value islands, led by Barbados (73), St. Martin (69) and — at the style end — St. Barths (54).",
      "At this price the skill isn't finding a villa; it's filtering 1,541 of them. The three questions that do most of the work: walk-to-something or gated-privacy? staffed-daily or weekly-service? and — the one people skip — how far is the beach/lift/town in minutes, not miles.",
    ],
    sections: [
      {
        h2: "Where $2,000/night lands you, by destination",
        table: {
          caption: "Counts of 8+-sleeper villas under $2,000/night by destination, from the Atlas, July 2026.",
          columns: ["Destination", "Villas available", "What the money buys"],
          rows: [
            ["Colorado", "200", "4–6BR ski homes; ski-in/out enters the budget outside festive weeks"],
            ["Hawaii", "189", "Big Island and Maui homes with pools; oceanfront needs timing or luck"],
            ["Italy", "112", "Tuscan/Umbrian farmhouses with pools; Amalfi at this price means hillside, not waterfront"],
            ["Florida", "108", "30A, Keys and Orlando estates — the domestic easy button"],
            ["France", "93", "Provence and Côte d'Azur hinterland; Alps in summer are a steal"],
            ["Barbados", "73", "Staffed west-coast houses — cooked breakfast included culture"],
            ["St. Martin", "69", "Terres Basses and Orient Bay; the Caribbean's best villa value"],
            ["St. Barths", "54", "2–3BR design villas — bring fewer friends, better sunglasses"],
            ["Greece / Costa Rica / Croatia", "49 / 45 / 40", "The rising class: new-build infinity-pool territory"],
          ],
        },
      },
      {
        h2: "How to pick well under $2,000",
        list: [
          "Spend on position, not bedrooms you won't use: a great 4BR beats a tired 6BR at the same rate.",
          "Shoulder seasons flip the market: the same Tuscan house is $1,100 in June and $1,900 in August; Caribbean May–June runs 30–40% under winter.",
          "Staff levels are the hidden differentiator — 'daily housekeeping + cook' vs. 'weekly clean' at identical rates. Ask, always.",
          "Check the from-rate's season: supplier from-rates are low-season anchors. Budget the quote, not the teaser.",
          "New-build Croatia, Costa Rica and Greece inventory often out-specs old-money islands at the same price — heated pools, gyms, cinema rooms.",
        ],
      },
    ],
    faqs: [
      {
        q: "Can I get beachfront under $2,000?",
        a: "Yes in St. Martin, Barbados (off-peak), Costa Rica and parts of Hawaii; rarely in St. Barths or Grace Bay in season. 'Three minutes' walk, ocean view' is where the value hides.",
      },
      {
        q: "Do these villas include a concierge?",
        a: "Yes — bookings through our supplier network include pre-arrival planning and an on-island manager: chefs, groceries, transfers, boats and babysitters arranged before you land.",
      },
      {
        q: "What's the catch versus a $5,000/night villa?",
        a: "Usually one of: location premium, architectural pedigree, full daily staff, or festive-week eligibility. The sleep-quality difference is smaller than the price difference — which is the entire thesis of this page.",
      },
    ],
    related: [
      { href: "/atlas/villa", label: "Filter the 1,541 on the Villa Atlas map" },
      { href: "/answers/best-caribbean-villas-for-12-guests", label: "Caribbean villas for 12+ guests" },
      { href: "/answers/villa-vs-resort-for-a-family-of-10", label: "Villa vs. resort cost math" },
    ],
  },
];
