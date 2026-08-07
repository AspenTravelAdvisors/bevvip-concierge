/**
 * Where a port is, from its name and coordinates.
 *
 * Shared by scripts/build-cruise-regions.mjs, which uses it to give every
 * expedition sailing a region its own itinerary agrees with, and by
 * scripts/verify-atlas-regions.mjs, which uses it to prove no collection tags a
 * trip with a region its stops are nowhere near.
 *
 * Every port name in the atlas feeds ends in its country ("Puerto Montt, Chile",
 * "Bergen, Norway", "Juneau, AK, United States"), which is what makes this
 * possible without a geocoder. Coordinates split the countries that straddle two
 * regions: Svalbard's ports are tagged "Norway", Galapagos' are tagged "Ecuador",
 * Danish Greenland's are tagged "Denmark".
 *
 * The region NAMES are the expedition-cruise feed's own display strings, since
 * that atlas shows them to travellers verbatim. The other five collections keep
 * their own region keys and map onto these names in the verifier.
 */

const MED = new Set(["Greece", "Italy", "Croatia", "Malta", "Turkey", "Albania", "Montenegro", "Slovenia", "Monaco", "Tunisia", "Algeria", "Gibraltar", "Cyprus", "Israel", "Egypt", "Libya", "Lebanon", "Syria", "Ionian Sea (Cruising)", "Strait of Gibraltar (Cruising)", "Baltic Sea (Cruising)"]);
const CARIBBEAN = new Set(["Saint Vincent And The Grenadines", "Guadeloupe", "Martinique", "Saint Lucia", "Barbados", "Saint Kitts And Nevis", "Montserrat", "Trinidad And Tobago", "Dominican Republic", "Bahamas", "British Virgin Islands", "Dominica", "Antigua And Barbuda", "Saint Barthélemy", "Aruba", "Curacao", "Sint Maarten", "Turks And Caicos Islands", "Saint Eustatius and Saba", "Bermuda", "Puerto Rico", "Jamaica", "Cuba", "Haiti", "Cayman Islands", "Anguilla", "Grenada", "Saint Martin", "US Virgin Islands"]);
const ASIA = new Set(["Japan", "South Korea", "China", "Taiwan", "Philippines", "Vietnam", "Thailand", "Malaysia", "Singapore", "Brunei Darussalam", "Indonesia", "Dili", "Cambodia", "Myanmar", "Hong Kong", "India", "Sri Lanka", "Maldives", "Oman", "United Arab Emirates", "Timor-Leste"]);
const OCEANIA = new Set(["Australia", "New Zealand", "Papua New Guinea", "Solomon Islands", "Vanuatu", "Fiji", "Tonga", "Samoa", "Niue", "Cook Islands", "Micronesia", "Northern Mariana Islands", "Apra Harbor", "Pagan", "Guam", "Palau", "Marshall Islands", "Kiribati", "New Caledonia", "Nauru", "Tuvalu", "Wallis and Futuna", "American Samoa", "Tokelau"]);
const AFRICA = new Set(["Seychelles", "Madagascar", "South Africa", "Namibia", "Angola", "Senegal", "Mozambique", "Tanzania", "Kenya", "Mauritius", "Reunion", "Comoros", "Gambia", "Guinea-Bissau", "Ghana", "Nigeria", "Benin", "Togo", "Ivory Coast", "Côte d'Ivoire", "Sierra Leone", "Liberia", "Mauritania", "Western Sahara", "Sao Tome And Principe", "Equatorial Guinea", "Gabon", "Congo", "Djibouti", "Eritrea", "Sudan", "Somalia"]);
const ANTARCTIC = new Set(["Antarctica", "Drake Passage (Cruising)", "Weddell Sea (Cruising)", "Scotia Sea", "Sea Ice Limit", "South Georgia And The South Sandwich Islands", "Falkland Islands (Malvinas)", "Bellingshausen Sea", "Ross Sea"]);
const N_EUROPE = new Set(["United Kingdom", "Ireland", "Isle Of Man", "Guernsey", "Jersey", "Faroe Islands", "Sweden", "Finland", "Estonia", "Latvia", "Lithuania", "Poland", "Germany", "Netherlands", "Belgium", "Russia", "Åland Islands", "English Channel (Cruising)", "Islands & Fjords (Cruising)"]);
const ATLANTIC_ISLANDS = new Set(["Cape Verde", "Ascension And Tristan Da Cunha", "Saint Helena"]);
const S_AMERICA = new Set(["Peru", "Brazil", "Uruguay", "French Guiana", "Suriname", "Guyana", "Bolivia", "Paraguay", "Venezuela"]);
const ARCTIC = new Set(["Svalbard And Jan Mayen", "Greenland", "East Coast of Greenland", "Denmark Strait", "Davis Strait", "Baffin Bay", "Iceland"]);
const RIVERS_EUROPE = new Set(["Switzerland", "Austria", "Hungary", "Slovakia", "Serbia", "Romania", "Bulgaria"]);

/**
 * Place one geocoded port. `name` always ends in a country (or a named body of
 * water); latitude and longitude split the countries that straddle regions —
 * Svalbard's ports are tagged "Norway", Galápagos' are tagged "Ecuador".
 */
export function portRegion(name, lat, lng) {
  const parts = String(name).split(",").map((s) => s.trim()).filter(Boolean);
  const tail = parts[parts.length - 1] || "";
  const hay = parts.join(", ");

  if (ANTARCTIC.has(tail)) return "Antarctica";
  if (MED.has(tail)) return "Mediterranean";
  if (CARIBBEAN.has(tail)) return "Caribbean & Bermuda";
  if (ASIA.has(tail)) return "Asia & Mekong";
  if (OCEANIA.has(tail)) return "Australia, NZ & South Pacific";
  if (AFRICA.has(tail)) return "Africa & Indian Ocean";
  if (ATLANTIC_ISLANDS.has(tail)) return "Atlantic Islands";
  if (S_AMERICA.has(tail)) return "Amazon & South America";
  if (N_EUROPE.has(tail)) return "Northern Europe & British Isles";
  if (ARCTIC.has(tail)) return "Arctic";
  if (RIVERS_EUROPE.has(tail)) return "Europe Rivers";
  if (tail === "French Polynesia" || tail === "Pitcairn Islands") return "Hawaii & Tahiti";
  // Svalbard's ports are inconsistently tagged: half say "Svalbard And Jan
  // Mayen", half say "Norway". Mainland Norway stops at 71.2°N (North Cape).
  if (tail === "Norway") return lat > 72 ? "Arctic" : "Norway, Fjords & Coast";
  // "Denmark" is used for both Copenhagen and Danish Greenland.
  if (tail === "Denmark") return lng < -10 && lat > 55 ? "Arctic" : "Northern Europe & British Isles";
  // Easter Island is Chilean and 3,500km out in the Pacific.
  if (tail === "Chile") {
    if (lng < -100) return "Hawaii & Tahiti";
    return lat <= -38 ? "Patagonia & Chilean Fjords" : "Amazon & South America";
  }
  if (tail === "Argentina") return lat <= -40 ? "Patagonia & Chilean Fjords" : "Amazon & South America";
  if (tail === "Ecuador") return lng < -88 ? "Galápagos" : "Amazon & South America";
  if (tail === "Colombia") return lat > 7 && lng < -72 ? "Caribbean & Bermuda" : "Amazon & South America";
  if (tail === "Panama" || tail === "Costa Rica" || tail === "Nicaragua" || tail === "Honduras" || tail === "Guatemala" || tail === "Belize" || tail === "El Salvador") return "Central America & Panama";
  if (tail === "Mexico") return lng < -108 ? "Baja California" : lng > -92 ? "Caribbean & Bermuda" : "Central America & Panama";
  if (tail === "Spain") return lat < 30 && lng < -12 ? "Atlantic Islands" : lng < -5.6 && lat > 36.5 ? "Western Europe & Iberia" : "Mediterranean";
  if (tail === "Portugal") return lat < 34 || (lat > 36 && lng < -24) ? "Atlantic Islands" : "Western Europe & Iberia";
  if (tail === "Morocco") return lng < -6 ? "Atlantic Islands" : "Mediterranean";
  // "France" reaches a long way past France: the Gambier and Marquesas islands
  // (Mangareva is tagged "France", not "French Polynesia"), Saint-Pierre-et-
  // Miquelon off Newfoundland, the Antilles and Guiana.
  if (tail === "France") {
    if (lng < -100) return "Hawaii & Tahiti";                 // French Polynesia
    if (lng < -20) return lat > 40 ? "Canada & New England"   // Saint-Pierre
      : lat > 10 ? "Caribbean & Bermuda"                      // the Antilles
        : "Amazon & South America";                           // Guiana
    return lng > 3.5 && lat < 44.5 ? "Mediterranean" : "Western Europe & Iberia";
  }
  if (tail === "Saint Pierre And Miquelon" || tail === "Gulf of St. Lawrence (Cruising)") return "Canada & New England";
  if (tail === "Bering Sea" || tail === "Bering Strait" || tail === "Gulf of Alaska (Cruising)") return "Alaska & Yukon";
  if (tail === "Canada") {
    if (lng < -120) return "Alaska & Yukon";               // BC — the Inside Passage
    if (lat >= 60) return "Arctic";                        // Nunavut / NWT
    if (lat >= 41 && lat <= 49 && lng <= -76 && lng >= -93) return "Great Lakes";
    return "Canada & New England";
  }
  if (tail === "United States" || /\b(AK|HI|CA|OR|WA|ME|MA|NY|RI|NH|CT|NJ|MD|VA|NC|SC|GA|FL|LA|MS|AL|TX|MI|WI|MN|OH|IL|IN|PA|DE)\b/.test(hay)) {
    // The Aleutians run west past the dateline, so the western bound is a pair.
    if (lat > 51 && (lng < -129 || lng > 170)) return "Alaska & Yukon";
    if (lat >= 18 && lat <= 23 && lng < -153) return "Hawaii & Tahiti";
    if (lng < -114) return "US Rivers & Coast";            // Pacific coast + Columbia
    if (lat >= 41 && lat <= 49 && lng <= -76 && lng >= -93) return "Great Lakes";
    if (lat >= 36 && lng > -82) return "Canada & New England";
    return "US Rivers & Coast";
  }
  // Named open water with no country: fall back to latitude bands.
  if (lat > 66) return "Arctic";
  if (lat < -55) return "Antarctica";
  return null;
}
