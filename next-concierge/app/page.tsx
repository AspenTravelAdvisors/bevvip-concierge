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
            <p>Approved hotels, expedition cruises, jets and luxury hotel yachts — mapped worldwide.</p>
          </div>
          <AtlasShell type="hotel" region={null} externalLink={internalAtlasLink("hotel")} scope="all" />
        </>
      }
    />
  );
}
