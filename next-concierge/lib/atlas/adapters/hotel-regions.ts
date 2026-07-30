/**
 * Hotels' macro-region table, lifted VERBATIM from public/maps/hotel/index.html.
 *
 * The visible "Region" axis is neither the feed's `region` (604 sub-national
 * admin values — "South Aegean", "Westminster") nor `marqueeRegion` (only 7
 * marketing keys). It is a curated country → region grouping, and the original
 * says why:
 *
 *   > Macro-regions — a short, human geographic filter built from each hotel's
 *   > country (the raw `region` field is a 600-way sub-national admin value,
 *   > far too granular for a checkbox list).
 *
 * Copied rather than re-derived so a shared `regions=Europe` link keeps meaning
 * exactly what it meant. A country missing from this table has no macro region
 * and is reachable only by search or the country axis — same as before.
 */

/* eslint-disable */
const groups: Record<string, string[]> = {
    "North America":["united states","usa","canada","bermuda"],
    "Caribbean":["saint barthelemy","saint barthélemy","bahamas","turks and caicos","turks and caicos islands",
      "anguilla","dominican republic","jamaica","saint lucia","grenada","antigua and barbuda","puerto rico",
      "british virgin islands","u.s. virgin islands","cayman islands","barbados","aruba","saint martin",
      "saint kitts and nevis","curacao","dominica","saint vincent and the grenadines"],
    "Mexico & Central America":["mexico","costa rica","panama","belize","nicaragua","honduras","guatemala","el salvador"],
    "South America":["brazil","peru","argentina","chile","colombia","ecuador","uruguay","bolivia","paraguay","venezuela"],
    "Europe":["italy","france","united kingdom","greece","spain","switzerland","portugal","germany","ireland",
      "austria","turkey","croatia","russia","netherlands","hungary","czech republic","belgium","malta","cyprus",
      "monaco","montenegro","sweden","denmark","slovenia","latvia","romania","iceland","poland","norway","finland",
      "andorra","luxembourg","estonia","lithuania","albania","serbia","bulgaria","slovakia","ukraine"],
    "Middle East":["united arab emirates","israel","qatar","oman","saudi arabia","jordan","bahrain","kuwait","lebanon"],
    "Africa":["south africa","morocco","egypt","seychelles","kenya","mauritius","zambia","zimbabwe","rwanda",
      "botswana","tanzania","mozambique","madagascar","cape verde","namibia","uganda","ethiopia","ghana","nigeria","tunisia"],
    "Asia":["china","thailand","japan","maldives","indonesia","india","vietnam","singapore","philippines","cambodia",
      "malaysia","south korea","sri lanka","bhutan","taiwan","nepal","mongolia","laos","hong kong","macau","myanmar"],
    "Oceania":["australia","fiji","new zealand","french polynesia","cook islands","papua new guinea","vanuatu","samoa","tonga","new caledonia"],
    "Polar":["antarctica","greenland"]
  };

const REGION_ORDER: string[] = ["North America","Caribbean","Mexico & Central America","South America",
  "Europe","Middle East","Africa","Asia","Oceania","Polar"];

/** Countries `region=caribbean` matches even when marqueeRegion says otherwise. */
const CARIBBEAN_COUNTRIES: Set<string> = new Set([
  "anguilla",
  "antigua and barbuda",
  "aruba",
  "bahamas",
  "barbados",
  "cayman islands",
  "curacao",
  "dominican republic",
  "grenada",
  "jamaica",
  "puerto rico",
  "saint lucia",
  "turks and caicos",
  "turks and caicos islands"
]);
/* eslint-enable */

const REGION_OF_COUNTRY: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const [region, countries] of Object.entries(groups))
    for (const c of countries as string[]) m[c] = region;
  return m;
})();

export { REGION_ORDER, CARIBBEAN_COUNTRIES };

export function macroRegion(country: string | null | undefined): string | null {
  return REGION_OF_COUNTRY[(country || "").trim().toLowerCase()] || null;
}

export function isCaribbeanCountry(country: string | null | undefined): boolean {
  return CARIBBEAN_COUNTRIES.has((country || "").toLowerCase());
}
