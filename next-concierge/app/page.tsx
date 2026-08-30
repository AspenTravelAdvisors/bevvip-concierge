import type { Metadata } from "next";
import GuideChat from "@/components/GuideChat";
import AtlasShell from "@/components/AtlasShell";
import HomeSplit from "@/components/HomeSplit";
import { collectionsCompact, collectionsHeadline, internalAtlasLink } from "@/lib/atlas-config";

/**
 * The home page's canonical, which did not exist.
 *
 * Every other indexable route sets `alternates.canonical` in its own metadata
 * and the root layout sets none — so the one page with the most inbound links
 * shipped no <link rel="canonical"> at all. That is not a cosmetic gap: the
 * origin is reachable as `/`, with a trailing-slash variant, and with whatever
 * query string the atlas's own Share button appends (?style, ?flat, ?@lat,lng),
 * and each of those is a separate URL to a crawler with nothing telling it
 * which one is the page.
 *
 * It is declared HERE rather than as a default in the root layout, and that is
 * the whole design decision. A canonical on the layout is inherited by every
 * descendant that does not override it, which would have pointed /atlas/hotel
 * and /atlas/villa at the home page — telling a crawler the atlas shells are
 * duplicates of `/` rather than pages of their own. Route-level is the only
 * altitude at which "this page is the home page" is a true statement.
 *
 * The relative "/" resolves against `metadataBase` in app/layout.tsx, which is
 * SITE_URL, which is NEXT_PUBLIC_SITE_URL. One origin, one place to change it.
 */
export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

// The landing page: The Guide docked over a populated globe.
//
// The heading here used to read "Living Atlas" — a proper noun for the thing
// the visitor was already looking at, which cost a decode step and returned
// nothing. And the blurb beneath it named four collections while the header
// offered seven and the legend showed however many had finished loading. All
// three now read the same canonical list.
//
// STAYS SYNCHRONOUS ON PURPOSE. The globe's Share button links back here, so
// this route has to understand ?style/?flat/?@ — but reading `searchParams`
// here would opt the landing page out of static prerendering, and a cold
// landing is exactly where that prerender is worth the most: the shell, the
// Guide panel and the atlas boot card all paint before any JS runs. AtlasShell
// reads those params itself, after mount, where they cost nothing. See
// `arrivedView` there.
export default function Home() {
  return (
    <HomeSplit
      chat={<GuideChat />}
      atlas={
        <>
          <div className="home-atlas-head">
            {/* The heading was "The whole collection, mapped" — true, and it
                answered a question nobody asks. A visitor looking at a globe
                already knows it's a map; what they can't tell is whether it
                holds eleven properties or eleven thousand, and that is the
                whole proposition. Lead with the number. See collectionsHeadline. */}
            <h2>{collectionsHeadline()}</h2>
            {/* One blurb, two lengths: phones swap in the short line via CSS. */}
            {/* Two lines, hard limit. This block is absolutely positioned
                directly above the map legend; a third line lands on top of it.
                The CSS clamps it as a backstop, but keep the copy short. */}
            <p>
              <span className="blurb-full">
                {collectionsCompact()}. Click any pin to explore.
              </span>
              <span className="blurb-short">
                Hotels, villas, expeditions, world cruises, rail, yachts and jets — mapped.
              </span>
            </p>
          </div>
          <AtlasShell
            type="hotel"
            region={null}
            externalLink={internalAtlasLink("hotel")}
            scope="all"
            // The one surface that owns its view through the URL alone: it has
            // no filters, so ?style/?flat/?@ is the whole of what a shared link
            // says. Turns on both the Share button and the shell's own reading
            // of those params on arrival.
            selfShare
            // Four captioned pins, dropped while the globe walks west, ending
            // the instant the visitor touches the map. The old IntroTour taught
            // the chrome and had to dim the product to do it; this teaches the
            // inventory using the product, and asks for nothing back.
            ambientTour
            // The collections panel is back, and it is a different control
            // than the one that was removed. That one was seven independent
            // hide/show switches over the most valuable corner of the only
            // thing on the page — a filter offered to people who are not
            // filtering. This one solos: a click isolates a collection, so the
            // panel answers "show me only the yachts" in one gesture and reads
            // as a key to the pin colours the rest of the time. On phones it
            // collapses to a pill and gives the corner back entirely.
            showLegend
          />
        </>
      }
    />
  );
}
