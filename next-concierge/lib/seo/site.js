// The site's identity graph — one Organization, one WebSite, written once.
//
// Every JSON-LD block on the site used to invent its own publisher inline
// (`lib/answers.js` still had `{"@type":"Organization","name":"Aspen Travel
// Advisors"}` typed into `faqJsonLd`). An answer engine reading two pages that
// each describe the publisher slightly differently has no way to know they are
// the same publisher, so the citations it builds attach to nothing. The fix is
// the `@id` discipline below: the organisation is DEFINED once, in the graph
// the root layout emits on every page, and every other block on the site
// REFERENCES it as `{ "@id": ORG_ID }` rather than describing it again.
//
// Nothing here is invented. Every fact is one the repository already asserts
// somewhere a visitor can see: the two outbound brand links in the header, the
// Virtuoso advisor profile it credits, and the address in lib/answers.js.

import { SITE_URL } from "@/lib/answers";

export const SITE_NAME = "Expedition Bucket List";
export const AGENCY_NAME = "Aspen Travel Advisors";
export const AGENCY_URL = "https://aspentraveladvisors.com";
export const BRAND_URL = "https://expeditionbucketlist.com";
export const VIRTUOSO_ADVISOR_URL =
  "https://www.virtuoso.com/advisor/brianharris/travel";

// Fragment identifiers, not page URLs: `#organization` is the agency itself,
// which is not the same resource as the home page that describes it.
export const ORG_ID = `${SITE_URL}/#organization`;
export const SITE_ID = `${SITE_URL}/#website`;

/** Reference the publisher without redescribing it. Use this everywhere. */
export const orgRef = () => ({ "@id": ORG_ID });

export function organizationJsonLd() {
  return {
    "@type": "TravelAgency",
    "@id": ORG_ID,
    name: AGENCY_NAME,
    url: SITE_URL,
    // The signals that let an answer engine reconcile "Aspen Travel Advisors"
    // across the open web with the entity publishing this page.
    sameAs: [AGENCY_URL, BRAND_URL, VIRTUOSO_ADVISOR_URL],
    brand: { "@type": "Brand", name: SITE_NAME, url: BRAND_URL },
    // The membership is the whole basis of the site's authority claim — the
    // perks it documents exist because of it — so it is stated in the markup
    // rather than left as a line of header prose.
    memberOf: {
      "@type": "Organization",
      name: "Virtuoso",
      url: "https://www.virtuoso.com",
    },
    knowsAbout: [
      "Luxury hotels",
      "Expedition cruising",
      "Virtuoso hotel benefits",
      "Private jet journeys",
      "Luxury rail journeys",
      "Villa rentals",
      "Safari lodges",
    ],
    areaServed: "Worldwide",
  };
}

export function websiteJsonLd() {
  return {
    "@type": "WebSite",
    "@id": SITE_ID,
    url: SITE_URL,
    name: SITE_NAME,
    publisher: orgRef(),
    inLanguage: "en",
  };
}

/**
 * The two nodes above as one `@graph`, for the root layout.
 *
 * Emitted on every page so the definition is always present on whatever page a
 * crawler happens to land on first — a reference to an `@id` that is nowhere
 * defined is worse than the duplicated inline publisher it replaced.
 */
export function siteGraphJsonLd() {
  return {
    "@context": "https://schema.org",
    "@graph": [organizationJsonLd(), websiteJsonLd()],
  };
}
