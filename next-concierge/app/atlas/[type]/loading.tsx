export default function Loading() {
  return (
    <div className="atlas-page">
      <div className="atlas-head">
        <h1>Charting the Atlas…</h1>
        <p>Plotting approved inventory.</p>
      </div>
      <div className="atlas-map">
        <div className="fallback">
          <span className="badge">Loading</span>
        </div>
      </div>
    </div>
  );
}
