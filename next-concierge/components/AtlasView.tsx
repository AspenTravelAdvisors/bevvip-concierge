"use client";

// The in-app atlas surface: the original standalone atlas (its own Leaflet/3D
// map, filters and dock) rendered as-is inside an iframe. It shares Base Camp's
// origin (the page is copied into public/maps/<type>/), so its relative fetches
// and the Hotel Atlas API proxy (see next.config.ts) just work. The Guide is
// reached from the atlas's own per-card "Ask The Guide" buttons (which navigate
// back to Base Camp's home Guide), so there is no separate dock here.
export default function AtlasView({ label, src }: { label: string; src: string }) {
  return (
    <div className="atlas-view">
      <iframe className="atlas-frame" src={src} title={`${label} — Living Atlas`} />
    </div>
  );
}
