import GuideChat from "@/components/GuideChat";
import AtlasShell from "@/components/AtlasShell";
import HomeSplit from "@/components/HomeSplit";
import { collectionsCompact, internalAtlasLink } from "@/lib/atlas-config";

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
// here would opt the landing page out of static prerendering, and this is the
// page carrying the SSR poster frame that puts a globe on screen before any JS
// runs. AtlasShell reads those params itself, after mount, where they cost
// nothing. See `arrivedView` there.
export default function Home() {
  return (
    <HomeSplit
      chat={<GuideChat />}
      atlas={
        <>
          <div className="home-atlas-head">
            <h2>The whole collection, mapped</h2>
            {/* One blurb, two lengths: phones swap in the short line via CSS. */}
            {/* Two lines, hard limit. This block is absolutely positioned
                directly above the map legend; a third line lands on top of it.
                The CSS clamps it as a backstop, but keep the copy short. */}
            <p>
              <span className="blurb-full">
                {collectionsCompact()}. Click any pin to ask about it.
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
            // No collections panel here. The home globe plots all seven, so the
            // legend was seven rows of key over the top-left of the world —
            // the most valuable corner of the only thing on the page — for a
            // surface where nobody is filtering. The collection pages, which
            // are for browsing, keep theirs.
            showLegend={false}
          />
        </>
      }
    />
  );
}
