/**
 * A Mapbox GL stand-in, enough of the API for AtlasShell to run headless.
 *
 * Not a renderer. It records what the shell ASKS the map to do — sources,
 * layers, paint properties, camera calls, popups — so a test can assert on the
 * request rather than on pixels. Served to the browser in place of the CDN
 * build by scripts/verify-atlas-ui.mjs.
 *
 * It exists because three of the four faults in the 2026-08-25 breakage were
 * invisible to every check the repo had: `npm run verify`, the type checker and
 * a production build were all clean while clicking a card drew no route and
 * froze the globe. A harness that only calls the atlas's own functions cannot
 * see that, because the failure was in what those functions handed to Mapbox
 * (a camera option present and undefined, which Mapbox reads as NaN) and in
 * which of them the app wires together.
 *
 * Deliberately dumb: it fires style.load and load on a timer, answers geometry
 * questions with plausible numbers, and never disagrees with the shell. Its job
 * is to let the real code run, not to model Mapbox faithfully.
 */
(function () {
  const listeners = new WeakMap();
  class Evented {
    constructor() { listeners.set(this, {}); }
    on(type, a, b) {
      const cb = typeof a === "function" ? a : b;
      const L = listeners.get(this);
      (L[type] = L[type] || []).push(cb);
      return this;
    }
    once(type, cb) { const w = (e) => { this.off(type, w); cb && cb(e); }; return this.on(type, w); }
    off(type, cb) { const L = listeners.get(this); if (L[type]) L[type] = L[type].filter((f) => f !== cb); return this; }
    fire(type, e) { if (window.__stub.trace) window.__stub.trace.push(type); const L = listeners.get(this); (L[type] || []).slice().forEach((f) => { try { f(e || { type }); } catch (err) { console.error("[stub] handler threw for " + type, err); window.__stubErrors.push(String(err && err.stack || err)); } }); }
  }
  window.__stubErrors = [];
  window.__stub = { sources: {}, layers: {}, camera: {}, calls: [] };
  class Map extends Evented {
    constructor(opts) {
      super();
      this._c = { lng: (opts.center || [0, 0])[0], lat: (opts.center || [0, 0])[1] };
      this._z = opts.zoom ?? 1; this._p = opts.pitch ?? 0; this._b = opts.bearing ?? 0;
      this._min = opts.minZoom ?? 0;
      window.__stub.map = this;
      setTimeout(() => { this.fire("style.load"); this.fire("load"); this.fire("idle"); }, 10);
    }
    getCanvas() { return { style: {} }; }
    getContainer() { return document.createElement("div"); }
    areTilesLoaded() { return true; }
    getZoom() { return this._z; } getMinZoom() { return this._min; }
    getCenter() { return { lng: this._c.lng, lat: this._c.lat }; }
    getBounds() { const d = 20; return { getWest: () => this._c.lng - d, getSouth: () => this._c.lat - d, getEast: () => this._c.lng + d, getNorth: () => this._c.lat + d }; }
    setCenter(c) { this._c = { lng: c.lng, lat: c.lat }; window.__stub.camera = this._cam(); this.fire("move"); this.fire("moveend"); }
    setZoom(z) { this._z = z; this.fire("zoomend"); this.fire("moveend"); }
    getPitch() { return this._p; } setPitch(p) { this._p = p; this.fire("pitchend"); }
    getBearing() { return this._b; }
    _cam() { return { center: [this._c.lng, this._c.lat], zoom: this._z, pitch: this._p, bearing: this._b }; }
    _move(o, kind) {
      if (o.center) this._c = Array.isArray(o.center) ? { lng: o.center[0], lat: o.center[1] } : { lng: o.center.lng, lat: o.center.lat };
      if (o.zoom != null) this._z = o.zoom;
      if (o.pitch != null) this._p = o.pitch;
      if (o.bearing != null) this._b = o.bearing;
      window.__stub.camera = this._cam();
      window.__stub.calls.push({ kind, ...this._cam() });
      this.fire("move"); this.fire("moveend"); this.fire("zoomend");
    }
    flyTo(o) { this._move(o, "flyTo"); }
    easeTo(o) { this._move(o, "easeTo"); }
    jumpTo(o) { this._move(o, "jumpTo"); }
    fitBounds(b, o) { window.__stub.calls.push({ kind: "fitBounds" }); this.fire("moveend"); }
    stop() {} resize() {} remove() {} setPadding() {} setFog() {}
    setStyle(u) { window.__stub.calls.push({ kind: "setStyle", url: String(u).slice(-40) }); setTimeout(() => this.fire("style.load"), 5); }
    setProjection(p) { window.__stub.projection = p; }
    addSource(id, s) { window.__stub.sources[id] = s.data; }
    getSource(id) { const S = window.__stub.sources; return id in S ? { setData: (d) => { S[id] = d; } } : undefined; }
    removeSource(id) { delete window.__stub.sources[id]; }
    addLayer(spec) { window.__stub.layers[spec.id] = spec; }
    getLayer(id) { return window.__stub.layers[id]; }
    removeLayer(id) { delete window.__stub.layers[id]; }
    setPaintProperty(id, k, v) { const l = window.__stub.layers[id]; if (l) (l.paint = l.paint || {})[k] = v; }
    setLayoutProperty(id, k, v) { const l = window.__stub.layers[id]; if (l) (l.layout = l.layout || {})[k] = v; }
    setFilter(id, f) { const l = window.__stub.layers[id]; if (l) l.filter = f; }
    queryRenderedFeatures() { return []; }
    project() { return { x: 0, y: 0 }; }
  }
  class Popup extends Evented {
    constructor() { super(); }
    setLngLat(x) { this._at = x; return this; }
    setHTML(h) { this._html = h; window.__stub.lastLabel = h; (window.__stub.labels = window.__stub.labels || []).push(h); return this; }
    setDOMContent() { return this; }
    addTo() { window.__stub.labelOpen = this._html; return this; }
    remove() { window.__stub.labelOpen = null; return this; }
    isOpen() { return !!window.__stub.labelOpen; }
  }
  class LngLatBounds {
    constructor() { this.w = 180; this.s = 90; this.e = -180; this.n = -90; }
    extend(c) { const lng = c[0], lat = c[1]; this.w = Math.min(this.w, lng); this.e = Math.max(this.e, lng); this.s = Math.min(this.s, lat); this.n = Math.max(this.n, lat); return this; }
    getWest() { return this.w; } getSouth() { return this.s; } getEast() { return this.e; } getNorth() { return this.n; }
  }
  window.mapboxgl = { Map, Popup, LngLatBounds, accessToken: "", supported: () => true, setRTLTextPlugin() {} };
})();
