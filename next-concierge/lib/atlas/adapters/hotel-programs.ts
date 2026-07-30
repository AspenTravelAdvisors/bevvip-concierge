/**
 * Program → domain, lifted VERBATIM from public/maps/hotel/index.html.
 *
 * These are the 38 preferred-partner programs (Virtuoso, Marriott STARS, Four
 * Seasons Preferred Partner…) — one entry per distinct `program` value in the
 * feed, so every program resolves to a logo. This is the axis the hotel atlas
 * labels "Brand / Program", and the logo is most of how a traveller recognises
 * it, so the map is carried across rather than regenerated.
 */
export const PROGRAM_DOMAINS: Record<string, string> = {
  "Virtuoso":"virtuoso.com",
  "Marriott STARS":"marriott.com",
  "Four Seasons Preferred Partner":"fourseasons.com",
  "Hilton for Luxury":"hilton.com",
  "Auberge Resorts Collection":"aubergeresorts.com",
  "Mandarin Oriental Fan Club":"mandarinoriental.com",
  "Shangri-La The Luxury Circle":"shangri-la.com",
  "Rosewood Elite":"rosewoodhotels.com",
  "Cadence Individual Partner":"cadencetravel.com",
  "Belmond Bellini Club":"belmond.com",
  "Kempinski Club 1897":"kempinski.com",
  "The Peninsula Pen Club":"peninsula.com",
  "Rocco Forte Knights":"roccofortehotels.com",
  "Relais & Châteaux":"relaischateaux.com",
  "Jumeirah Passport to Luxury":"jumeirah.com",
  "Canaves Oia Luxury Resorts":"canavesthe.com",
  "Oetker Collection":"oetkercollection.com",
  "Maybourne Illustrated":"maybourne.com",
  "Autograph Collection":"autographhotels.marriott.com",
  "Outrigger":"outrigger.com",
  "Ritz-Carlton Reserve":"ritzcarlton.com",
  "Hartling Group (The Palms / The Shore Club / The Sands)":"thepalms.tc",
  "Fairmont":"fairmont.com",
  "Doyle Collection (The Circle)":"doylecollection.com",
  "Gran Meliá":"granmelia.com",
  "Waldorf Astoria":"waldorfastoria.hilton.com",
  "Ted Turner Reserves":"tedturnerreserves.com",
  "Design Hotels":"designhotels.com",
  "Hyatt Privé":"hyatt.com",
  "Thompson Hotels":"thompsonhotels.com",
  "Angsana":"angsana.com",
  "Grecotel":"grecotel.com",
  "Gurney's":"gurneysresorts.com",
  "Viceroy":"viceroyhotelsandresorts.com",
  "Langham":"langhamhotels.com",
  "Al Zorah":"alzorah.ae",
  "Taj Hotels":"tajhotels.com",
  "Corinthia":"corinthia.com",
};

/** Domain for a program, or null when it has no known mark. */
export function programDomain(program: string | null | undefined): string | null {
  return (program && PROGRAM_DOMAINS[program]) || null;
}
