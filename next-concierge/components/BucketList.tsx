"use client";

/**
 * The bucket list page.
 *
 * Three things it has to do, in order of how much they matter:
 *
 *   1. Show what was kept, in a way that still reads months later. Every row
 *      draws from the item's own saved fields (lib/bucket-list), not from a
 *      feed — so the page is instant, works with every collection's data
 *      offline, and a sailing that has since sold out still says what it was.
 *   2. Get back to it. Each row keeps the route to its own atlas, which for a
 *      hotel opens the dossier and the orbit and for a route collection filters
 *      down to that one journey.
 *   3. Hand the whole list to a person. This is the conversion the list exists
 *      to produce: a curated set beats the residue of a search, and
 *      buildAdvisorContext now prefers it (see lib/handoff).
 *
 * Grouped by collection, in the Explore menu's own order, so a list holding a
 * hotel, two sailings and a villa reads as a trip rather than a pile.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ATLASES, COLLECTIONS } from "@/lib/atlas-config";
import { askAboutBucketList, askAboutSaved, askGuide, askGuideHref } from "@/lib/atlas/ask";
import { bucketListOpened, bucketListRemoved } from "@/lib/analytics";
import {
  bucketListCount,
  clearBucketList,
  removeItem,
  useBucketList,
  type SavedItem,
} from "@/lib/bucket-list";
import { openAdvisor, ADVISOR_CTA, ADVISOR_SLA } from "./AdvisorRequest";
import type { OfferingType } from "@/lib/types";

export default function BucketList() {
  const items = useBucketList();
  const router = useRouter();
  const [confirmClear, setConfirmClear] = useState(false);
  /*
   * The list lives in localStorage, so the server renders nothing and the first
   * client paint is empty by definition (useSyncExternalStore's server
   * snapshot). Without this flag a traveller with eleven saved items sees "Your
   * bucket list is empty" for a frame — the one thing this page must never say
   * wrongly.
   */
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(true);
    bucketListOpened(bucketListCount());
  }, []);

  const groups = useMemo(() => groupByCollection(items), [items]);

  if (!ready) {
    return (
      <div className="bl-wrap">
        <header className="bl-head">
          <h1>Your bucket list</h1>
          <p className="bl-lede">Opening your list…</p>
        </header>
      </div>
    );
  }

  if (items.length === 0) return <EmptyList />;

  return (
    <div className="bl-wrap">
      <header className="bl-head">
        <h1>Your bucket list</h1>
        <p className="bl-lede">
          {items.length === 1 ? "One thing" : `${items.length} things`} you&rsquo;ve kept
          {groups.length > 1 ? `, across ${groups.length} collections` : ""}. Saved on this
          device — nothing here has been sent anywhere until you send it.
        </p>
        <div className="bl-head-actions">
          <button
            type="button"
            className="bl-send"
            onClick={() => openAdvisor({ source: "bucketlist" })}
          >
            {ADVISOR_CTA}
          </button>
          {/*
            The list's own question, which no single row can ask: by the time
            someone has kept four things they are comparing them.
          */}
          <button
            type="button"
            className="bl-ask-all"
            onClick={() => {
              const text = askAboutBucketList(items.map((i) => i.title));
              if (!askGuide(text, "card")) router.push(askGuideHref(text, "bucket-list"));
            }}
          >
            ✦ Ask The Guide about these
          </button>
        </div>
        <p className="bl-sla">{ADVISOR_SLA}</p>
      </header>

      {groups.map(({ type, items: rows }) => (
        <section className="bl-group" key={type}>
          <h2>
            <i className="bl-dot" style={{ background: ATLASES[type]?.color }} aria-hidden="true" />
            {ATLASES[type]?.nav ?? type}
            <span className="bl-group-count">{rows.length}</span>
          </h2>
          <ul className="bl-rows">
            {rows.map((item) => (
              <Row key={item.key} item={item} router={router} />
            ))}
          </ul>
        </section>
      ))}

      <footer className="bl-foot">
        {/*
          Destructive and irreversible, so it asks — but only after being
          pressed, rather than sitting behind a permanent "are you sure".
        */}
        {confirmClear ? (
          <span className="bl-confirm">
            Clear all {items.length}?{" "}
            <button
              type="button"
              className="bl-clear bl-clear--yes"
              onClick={() => {
                clearBucketList();
                setConfirmClear(false);
              }}
            >
              Yes, clear it
            </button>{" "}
            <button type="button" className="bl-clear" onClick={() => setConfirmClear(false)}>
              Keep it
            </button>
          </span>
        ) : (
          <button type="button" className="bl-clear" onClick={() => setConfirmClear(true)}>
            Clear the list
          </button>
        )}
      </footer>
    </div>
  );
}

function Row({ item, router }: { item: SavedItem; router: ReturnType<typeof useRouter> }) {
  return (
    <li className="bl-row">
      {/* Only where there is a photograph. A grid of grey rectangles is the
          failure the stay card's media slot is careful to avoid, and a list
          mixing hotels (photographed) with sailings (not) would show both.

          The URL was copied in at save time and this list is built to outlive
          the feed it came from, so a supplier's image WILL eventually 404 here.
          When it does the row loses its picture rather than showing a broken
          one — the saved note is still the point. */}
      {item.thumb && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="bl-thumb"
          src={item.thumb}
          alt=""
          loading="lazy"
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
      )}
      <div className="bl-row-body">
        <h3>
          {item.href ? <Link href={item.href}>{item.title}</Link> : item.title}
        </h3>
        {item.subtitle && <p className="bl-sub">{item.subtitle}</p>}
        {item.brand && <p className="bl-brand">{item.brand}</p>}
        <div className="bl-row-actions">
          {item.href && (
            <Link className="bl-link" href={item.href}>
              See on the map →
            </Link>
          )}
          {item.url && (
            <a className="bl-link" href={item.url} target="_blank" rel="noopener noreferrer">
              View details ↗
            </a>
          )}
          <button
            type="button"
            className="bl-link"
            onClick={() => {
              const text = askAboutSaved(item);
              if (!askGuide(text, "card")) router.push(askGuideHref(text, "bucket-list"));
            }}
          >
            ✦ Ask The Guide
          </button>
          <button
            type="button"
            className="bl-link bl-remove"
            onClick={() => {
              removeItem(item.key);
              bucketListRemoved(item.type, "list", bucketListCount());
            }}
          >
            Remove
          </button>
        </div>
      </div>
      {item.savedAt && (
        <time className="bl-saved mono" dateTime={item.savedAt}>
          {savedLabel(item.savedAt)}
        </time>
      )}
    </li>
  );
}

/**
 * The empty state, which is most of this page's job on a first visit.
 *
 * It says what the list is FOR and points at the two ways to fill it, because
 * a page reading only "nothing saved yet" teaches nobody that saving exists.
 */
function EmptyList() {
  return (
    <div className="bl-wrap bl-wrap--empty">
      <header className="bl-head">
        <h1>Your bucket list</h1>
        <p className="bl-lede">
          Nothing kept yet. Anywhere you see <span className="bl-glyph-inline">♡</span> — on a
          card, a map pin or a property&rsquo;s file — keeps it here, across visits, until you
          hand the whole list to an advisor to price.
        </p>
      </header>
      <div className="bl-empty-ways">
        <Link className="bl-send" href="/">
          Describe the trip to The Guide
        </Link>
        <div className="bl-empty-links">
          <span>or browse a collection:</span>
          {COLLECTIONS.map((c) => (
            <Link key={c.type} href={`/atlas/${c.type}`}>
              {c.nav}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Group in the Explore menu's order rather than by how recently things were
 * saved. Within a group the storage order — newest first — is kept.
 */
function groupByCollection(items: SavedItem[]): Array<{ type: OfferingType; items: SavedItem[] }> {
  const byType = new Map<OfferingType, SavedItem[]>();
  for (const item of items) {
    const list = byType.get(item.type);
    if (list) list.push(item);
    else byType.set(item.type, [item]);
  }
  const out: Array<{ type: OfferingType; items: SavedItem[] }> = [];
  for (const c of COLLECTIONS) {
    const rows = byType.get(c.type);
    if (rows) {
      out.push({ type: c.type, items: rows });
      byType.delete(c.type);
    }
  }
  // Anything saved under a type the registry no longer lists still shows —
  // a list that silently drops entries is worse than one with an odd heading.
  for (const [type, rows] of byType) out.push({ type, items: rows });
  return out;
}

/** "Today", "Yesterday", then a plain date. An advisor reads the age, not the clock. */
function savedLabel(iso: string): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000);
  if (days <= 0) return "Saved today";
  if (days === 1) return "Saved yesterday";
  if (days < 7) return `Saved ${days} days ago`;
  return `Saved ${then.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}
