"use client";

// The in-app atlas surface: the original standalone atlas (its own Leaflet/3D
// map, filters and dock) rendered as-is inside an iframe. It shares Base Camp's
// origin (the page is copied into public/maps/<type>/), so its relative fetches
// and the Hotel Atlas API proxy (see next.config.ts) just work. The Guide is
// reached from the atlas's own per-card "Ask The Guide" buttons (which navigate
// back to Base Camp's home Guide), so there is no separate dock here.
// With `hero` (from /atlas/<type>?hero=1) the view is an ambient backdrop for
// the marketing landers: Base Camp's header is hidden via .atlas-view--hero.
export default function AtlasView({
  label,
  src,
  hero = false,
}: {
  label: string;
  src: string;
  hero?: boolean;
}) {
  return (
    <div className={`atlas-view${hero ? " atlas-view--hero" : ""}`}>
      <iframe className="atlas-frame" src={src} title={`${label} — Living Atlas`} />
    </div>
  );
}
