import GuideChat from "@/components/GuideChat";
import AtlasShell from "@/components/AtlasShell";
import HomeSplit from "@/components/HomeSplit";
import { internalAtlasLink } from "@/lib/atlas-config";

// Base Camp landing: The Guide on the left, the Living Atlas globe on the right,
// already populated (hotels + cruise/jet/yacht/world-cruise region pins) on
// first paint — the same single-screen pairing as the standalone atlas. The
// gutter between the two panes drags to trade space toward more chat or map.
export default function Home() {
  return (
    <HomeSplit
      chat={<GuideChat />}
      atlas={
        <>
          <div className="home-atlas-head">
            <h2>Living Atlas</h2>
            {/* One blurb, two lengths: phones swap in the short line via CSS. */}
            <p>
              <span className="blurb-full">2,500 hotels where the VIP upgrade is already arranged. Expedition cruises. Private jets. Luxury hotel yachts. The entire world, mapped — spin it, zoom in, click. You were going anyway.</span>
              <span className="blurb-short">2,500 VIP-upgrade hotels. Jets, yachts, expeditions — the world, mapped. You were going anyway.</span>
            </p>
          </div>
          <AtlasShell type="hotel" region={null} externalLink={internalAtlasLink("hotel")} scope="all" />
        </>
      }
    />
  );
}
