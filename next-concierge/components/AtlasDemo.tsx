"use client";

/**
 * The home globe's scripted demonstration — `/?demo`. See lib/demo.ts.
 *
 * Four scenes, each driven through the same event bus the product already
 * runs on, so nothing here is a mock of the site — it IS the site, conducted:
 *
 *   1. Title    — "Eight collections. One globe." over an empty planet.
 *   2. Build    — the collections switch on one beat at a time, sparsest
 *                 first, with each one's name and size and a running total.
 *   3. Question — a question types itself, the real Guide answers it, and
 *                 the globe flies to the shortlist the answer plotted.
 *   4. End card — the line, the brand, the address.
 *
 * Renders nothing at all without `?demo`, so mounting it on the home page
 * costs a traveller one effect that reads the URL and stops.
 */

import { useEffect, useRef, useState } from "react";
import { ATLASES, collectionsHeadline } from "@/lib/atlas-config";
import {
  DEMO_BUILD_ORDER,
  demoMode,
  type DemoGuideDetail,
  type DemoLoadedDetail,
  type DemoMode,
  type DemoStageDetail,
} from "@/lib/demo";

/*
 * The beat. Tuned to be filmed at 1x and still read at 2x: every caption is
 * on screen for at least a second and a half of real time, and the build
 * itself lands on an even rhythm someone can cut music to.
 */
const TITLE_LINE_MS = 1300;
const TITLE_HOLD_MS = 1200;
const BUILD_BEAT_MS = 1500;
const TOTAL_HOLD_MS = 3000;
const TYPE_CHAR_MS = 34;
const QUESTION_HOLD_MS = 900;
const ANSWER_HOLD_MS = 7000;
/** How long the build waits for feeds still in flight before starting anyway. */
const LOAD_CAP_MS = 15000;
/** How long the question waits for the Guide's shortlist before moving on. */
const ANSWER_CAP_MS = 45000;

const NUMBER_WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
const nf = new Intl.NumberFormat("en-US");

interface Chip {
  label: string;
  color: string;
  count: number;
}

interface Scene {
  title: string[];
  /** The running total, or null while it is not on screen. */
  total: number | null;
  chip: Chip | null;
  /** The question, as far as it has been typed. */
  quote: string | null;
  caption: string | null;
  end: boolean;
}

const BLANK: Scene = { title: [], total: null, chip: null, quote: null, caption: null, end: false };

export default function AtlasDemo() {
  const [mode, setMode] = useState<DemoMode>({ kind: "off" });
  const [scene, setScene] = useState<Scene>(BLANK);
  const shown = useCountUp(scene.total);
  const loadedRef = useRef<Set<string>>(new Set());
  const plottedRef = useRef(false);

  useEffect(() => {
    setMode(demoMode());
  }, []);

  useEffect(() => {
    if (mode.kind === "off") return;
    const root = document.documentElement;
    root.classList.add("demo-on");

    const onLoaded = (e: Event) => {
      loadedRef.current = new Set((e as CustomEvent<DemoLoadedDetail>).detail?.keys ?? []);
    };
    const onPlot = () => {
      plottedRef.current = true;
    };
    // Esc leaves at any point. For whoever is operating the capture, so it is
    // never drawn on screen while the script runs; the end card has buttons.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") exitDemo();
    };
    window.addEventListener("bevvip:atlas-loaded", onLoaded as EventListener);
    window.addEventListener("bevvip:atlas-plot", onPlot);
    window.addEventListener("keydown", onKey);

    let cancelled = false;
    const timers = new Set<number>();
    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        const t = window.setTimeout(() => {
          timers.delete(t);
          resolve();
        }, ms);
        timers.add(t);
      });
    /** Resolve once `ok()` holds or `capMs` has passed, polling at 100ms. */
    const until = async (ok: () => boolean, capMs: number) => {
      const start = Date.now();
      while (!cancelled && !ok() && Date.now() - start < capMs) await sleep(100);
    };
    const stage = (keys: string[] | null) =>
      window.dispatchEvent(new CustomEvent<DemoStageDetail>("bevvip:atlas-stage", { detail: { keys } }));
    const guide = (open: boolean) =>
      window.dispatchEvent(new CustomEvent<DemoGuideDetail>("bevvip:demo-guide", { detail: { open } }));
    const set = (patch: Partial<Scene>) => {
      if (!cancelled) setScene((s) => ({ ...s, ...patch }));
    };

    const order = DEMO_BUILD_ORDER.filter((t) => t in ATLASES);

    (async () => {
      // ── 1. Title ────────────────────────────────────────────────────────
      const n = NUMBER_WORDS[order.length] ?? String(order.length);
      set({ title: [`${n} collections.`] });
      await sleep(TITLE_LINE_MS);
      set({ title: [`${n} collections.`, "One globe."] });
      await sleep(TITLE_HOLD_MS);
      // The title doubles as the cover for a cold load: it holds until every
      // feed is on the map, so no beat switches on a collection still empty.
      await until(() => order.every((t) => loadedRef.current.has(t)), LOAD_CAP_MS);
      if (cancelled) return;

      // ── 2. Build ────────────────────────────────────────────────────────
      set({ title: [], total: 0 });
      const on: string[] = [];
      let total = 0;
      for (const type of order) {
        if (cancelled) return;
        const c = ATLASES[type];
        on.push(type);
        total += c.count;
        stage([...on]);
        set({ chip: { label: c.nav, color: c.color, count: c.count }, total });
        await sleep(BUILD_BEAT_MS);
      }
      // Hand the stage back: from here on the globe is in its ordinary state,
      // and anything the Guide plots is drawn exactly as a traveller sees it.
      stage(null);
      set({ chip: null, caption: collectionsHeadline().replace(/^[\d,]+ /, "") });
      await sleep(TOTAL_HOLD_MS);
      if (cancelled) return;

      // ── 3. Question ─────────────────────────────────────────────────────
      if (mode.kind === "ask") {
        set({ total: null, caption: "Now ask it something." });
        await sleep(QUESTION_HOLD_MS);
        const q = mode.question;
        for (let i = 1; i <= q.length; i++) {
          if (cancelled) return;
          set({ quote: q.slice(0, i) });
          await sleep(TYPE_CHAR_MS);
        }
        await sleep(QUESTION_HOLD_MS);
        plottedRef.current = false;
        guide(true);
        // The real Guide, through the same pipeline as the composer — this
        // is the beat a static recording of the site could never produce.
        window.dispatchEvent(new CustomEvent("bevvip:guide-ask", { detail: { text: q, source: "dock" } }));
        set({ quote: null, caption: "Searching every collection at once…" });
        await until(() => plottedRef.current, ANSWER_CAP_MS);
        if (cancelled) return;
        set({ caption: "Technology finds the options." });
        await sleep(ANSWER_HOLD_MS);
      }

      // ── 4. End card ─────────────────────────────────────────────────────
      // Park the Guide first: the card is the whole frame, and an open panel
      // or sheet would sit beside it (desktop) or show through it (phone).
      guide(false);
      set({ total: null, caption: null, quote: null, end: true });
    })();

    return () => {
      cancelled = true;
      timers.forEach((t) => window.clearTimeout(t));
      root.classList.remove("demo-on");
      window.removeEventListener("bevvip:atlas-loaded", onLoaded as EventListener);
      window.removeEventListener("bevvip:atlas-plot", onPlot);
      window.removeEventListener("keydown", onKey);
    };
  }, [mode]);

  if (mode.kind === "off") return null;

  return (
    <div className="atlas-demo" aria-live="polite">
      {scene.title.length > 0 && (
        <h2 className="ad-title">
          {scene.title.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </h2>
      )}

      {scene.total !== null && (
        <div className="ad-total">
          <strong>{nf.format(shown)}</strong>
          {scene.caption && <span className="ad-cap">{scene.caption}</span>}
        </div>
      )}

      {scene.chip && (
        <div className="ad-chip" key={scene.chip.label}>
          <i style={{ background: scene.chip.color }} />
          <span>{scene.chip.label}</span>
          <b>+{nf.format(scene.chip.count)}</b>
        </div>
      )}

      {scene.total === null && scene.caption && !scene.end && (
        <p className="ad-line" key={scene.caption}>{scene.caption}</p>
      )}

      {scene.quote !== null && (
        <blockquote className="ad-quote">
          “{scene.quote}
          <span className="ad-caret" aria-hidden="true" />”
        </blockquote>
      )}

      {scene.end && (
        <div className="ad-end">
          <p className="ad-end-a">Technology finds the options.</p>
          <p className="ad-end-b">We make them VIP.</p>
          <p className="ad-end-c">
            Book with Aspen Travel Advisors
            <span>guide.expeditionbucketlist.com</span>
          </p>
          <div className="ad-ctrl">
            <button type="button" onClick={() => window.location.reload()}>
              Replay
            </button>
            <button type="button" onClick={exitDemo}>
              Exit demo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function exitDemo() {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete("demo");
    window.location.href = url.pathname + url.search + url.hash;
  } catch {
    window.location.href = "/";
  }
}

/**
 * The running total, counted up rather than swapped.
 *
 * Each beat adds a collection's size to the target and the figure climbs to it
 * over most of the beat — the number moving is half of what makes the build
 * read as accumulation instead of as a list.
 */
function useCountUp(target: number | null, ms = 900): number {
  const [value, setValue] = useState(0);
  const fromRef = useRef(0);
  const valueRef = useRef(0);
  valueRef.current = value;

  useEffect(() => {
    if (target === null) return;
    fromRef.current = valueRef.current;
    const from = fromRef.current;
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(Math.round(from + (target - from) * eased));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);

  return value;
}
