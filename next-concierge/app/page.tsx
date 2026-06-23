import GuideChat from "@/components/GuideChat";
import AtlasShell from "@/components/AtlasShell";
import { externalAtlasLink } from "@/lib/atlas-config";

// Base Camp landing: The Guide on the left, the Living Atlas globe on the right,
// already populated (hotels + cruise/jet/yacht/world-cruise region pins) on
// first paint — the same single-screen pairing as the standalone atlas.
export default function Home() {
  return (
    <div className="home">
      <div className="home-chat">
        <GuideChat />
      </div>
      <aside className="home-atlas">
        <div className="home-atlas-head">
          <h2>Living Atlas</h2>
          <p>Approved hotels, expedition cruises, jets and hotel-brand yachts — mapped worldwide.</p>
        </div>
        <AtlasShell type="hotel" region={null} externalLink={externalAtlasLink("hotel")} scope="all" />
      </aside>
    </div>
  );
}
