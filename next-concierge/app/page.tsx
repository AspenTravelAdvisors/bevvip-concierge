import GuideChat from "@/components/GuideChat";
import AtlasShell from "@/components/AtlasShell";
import HomeSplit from "@/components/HomeSplit";
import { collectionsSummary, internalAtlasLink } from "@/lib/atlas-config";

// The landing page: The Guide docked over a populated globe.
//
// The heading here used to read "Living Atlas" — a proper noun for the thing
// the visitor was already looking at, which cost a decode step and returned
// nothing. And the blurb beneath it named four collections while the header
// offered seven and the legend showed however many had finished loading. All
// three now read the same canonical list.
export default function Home() {
  return (
    <HomeSplit
      chat={<GuideChat />}
      atlas={
        <>
          <div className="home-atlas-head">
            <h2>The whole collection, mapped</h2>
            {/* One blurb, two lengths: phones swap in the short line via CSS. */}
            <p>
              <span className="blurb-full">
                {collectionsSummary()} — every one of them placed in the world. Spin it, zoom
                in, click a pin to ask about it.
              </span>
              <span className="blurb-short">
                Hotels, villas, expeditions, world cruises, rail, yachts and jets — mapped.
              </span>
            </p>
          </div>
          <AtlasShell type="hotel" region={null} externalLink={internalAtlasLink("hotel")} scope="all" />
        </>
      }
    />
  );
}
