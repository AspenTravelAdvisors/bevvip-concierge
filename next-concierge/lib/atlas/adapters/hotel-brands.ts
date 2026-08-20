/**
 * Hotel BRAND → domain, for the mark on a hotel card.
 *
 * WHY THIS EXISTS, given hotel-programs.ts already maps a domain per program:
 * the program is the preferred-partner agreement (Virtuoso, Marriott STARS,
 * Four Seasons Preferred Partner…), and 1,970 of the 2,501 hotels are Virtuoso.
 * Keying the logo on the program therefore printed the same virtuoso.com
 * favicon on four cards out of five — a mark that identified the paperwork
 * rather than the hotel, and carried no information at all in a grid. The brand
 * is what a traveller recognises: Aman, Bulgari, Belmond, The Connaught.
 *
 * 926 hotels carry a brand across 59 values; 58 are mapped here. The brand mark
 * wins where it exists and the program mark stays as the fallback (see
 * `logoKey` in hotel.ts), so no card loses a logo it used to have.
 *
 * EVERY DOMAIN WAS CHECKED against the icon services BrandLogo actually uses —
 * a domain with no favicon there is worse than no entry, because it spends the
 * whole fallback chain to arrive at the same initials. Three plausible guesses
 * failed that check and were replaced by the domain that works:
 * stregis.marriott.com → stregis.com, bulgarihotels.com → bulgari.com,
 * roccofortehotels.com → roccoforte.com (all three answered with Google's
 * generic globe placeholder). "The Gritti Palace" is deliberately absent: its
 * apparent domain could not be confirmed as the hotel's own, and a wrong mark
 * is worse than its program's.
 *
 * Sub-brands point at the group where the group is what carries the mark
 * (Park Hyatt/Andaz/Grand Hyatt/Hyatt Regency → hyatt.com, Conrad → hilton.com,
 * Westin → marriott.com), and at the managing house where that house IS the
 * name on the door (The Carlyle and Hôtel de Crillon → rosewoodhotels.com).
 */
export const HOTEL_BRAND_DOMAINS: Record<string, string> = {
  "Ritz-Carlton": "ritzcarlton.com",
  "Ritz-Carlton Reserve": "ritzcarlton.com",
  "Mandarin Oriental": "mandarinoriental.com",
  "Four Seasons": "fourseasons.com",
  "Fairmont": "fairmont.com",
  "St. Regis": "stregis.com",
  "Shangri-La": "shangri-la.com",
  "Park Hyatt": "hyatt.com",
  "Andaz": "hyatt.com",
  "Grand Hyatt": "hyatt.com",
  "Hyatt Regency": "hyatt.com",
  "Aman": "aman.com",
  "Rosewood": "rosewoodhotels.com",
  "The Carlyle": "rosewoodhotels.com",
  "Hôtel de Crillon": "rosewoodhotels.com",
  "Auberge Resorts": "aubergeresorts.com",
  "Anantara": "anantara.com",
  "Waldorf Astoria": "waldorfastoria.hilton.com",
  "Conrad": "hilton.com",
  "Belmond": "belmond.com",
  "Kempinski": "kempinski.com",
  "One&Only": "oneandonlyresorts.com",
  "Sofitel": "sofitel.accor.com",
  "Raffles": "raffles.com",
  "Six Senses": "sixsenses.com",
  "Rocco Forte": "roccoforte.com",
  "EDITION": "editionhotels.com",
  "Banyan Tree": "banyantree.com",
  "The Peninsula": "peninsula.com",
  "COMO": "comohotels.com",
  "Capella": "capellahotels.com",
  "Jumeirah": "jumeirah.com",
  "Nobu": "nobuhotels.com",
  "Thompson": "thompsonhotels.com",
  "Bulgari": "bulgari.com",
  "Pendry": "pendry.com",
  "Oetker Collection": "oetkercollection.com",
  "Le Bristol": "lebristolparis.com",
  "1 Hotel": "1hotels.com",
  "Cheval Blanc": "chevalblanc.com",
  "Montage": "montagehotels.com",
  "Regent": "regenthotels.com",
  "Atlantis": "atlantis.com",
  "Faena": "faena.com",
  "Soneva": "soneva.com",
  "Armani": "armanihotels.com",
  "Claridge's": "claridges.co.uk",
  "The Berkeley": "the-berkeley.co.uk",
  "The Connaught": "the-connaught.co.uk",
  "The Savoy": "thesavoylondon.com",
  "Westin": "marriott.com",
  "Baccarat": "baccarathotels.com",
  "Bellagio": "bellagio.mgmresorts.com",
  "The Ritz": "theritzlondon.com",
  "Sandy Lane": "sandylane.com",
  "The Mark": "themarkhotel.com",
  "The Setai": "thesetaihotel.com",
  "Wynn": "wynnresorts.com",
  // The IHG Destined brands (see hotel-programs.ts). The feed left `brand` null
  // on most of these; program-overrides.json fills it, so each family shows its
  // own mark instead of falling back to the program's.
  "InterContinental": "ihg.com",
  "Kimpton": "kimptonhotels.com",
  "Hotel Indigo": "ihg.com",
  "Vignette Collection": "ihg.com",
};

/** Domain for a hotel brand, or null when it has no confirmed mark. */
export function hotelBrandDomain(brand: string | null | undefined): string | null {
  return (brand && HOTEL_BRAND_DOMAINS[brand]) || null;
}
