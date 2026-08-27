"use client";

/**
 * The file for one sailing or journey — the counterpart to HotelDossier.
 *
 * The five journey atlases have never had one. A card could say where a voyage
 * goes and when, and everything the supplier wrote about it — the description,
 * the day-by-day itinerary, what the fare covers, the live offers — existed only
 * in the feed. The Virtuoso migration filled those fields for every collection,
 * so this is where they surface.
 *
 * Unlike the hotel dossier this fetches nothing. Each atlas already downloads
 * its whole itinerary feed to draw the map, so the record is in memory before
 * the traveller clicks; a round trip to an API for data the page is holding
 * would be latency bought for nothing.
 */

import { useEffect, useRef } from "react";
import { askAboutDays, askGuide, askGuideHref } from "@/lib/atlas/ask";
import { experiencesAsked } from "@/lib/analytics";

/** What every collection can supply, whatever its own feed calls things. */
export interface JourneyRecord {
  title: string;
  /** Cruise line, tour operator, or rail company. */
  operator?: string | null;
  ship?: string | null;
  dates?: string | null;
  days?: number | null;
  from?: string | null;
  to?: string | null;
  description?: string | null;
  /** Ordered stops. `sea` marks a day at sea, which has no place name. */
  itinerary?: { day?: number | null; name?: string | null; sea?: boolean }[];
  included?: string[];
  offers?: { name?: string | null; endDate?: string | null; exclusive?: boolean; description?: string | null }[];
  /** Where to book — the advisor-attributed supplier link. */
  href?: string | null;
}

export default function JourneyDossier({
  record,
  close,
}: {
  record: JourneyRecord;
  close: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  // Escape closes it, matching the hotel dossier and the filter drawer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  const stops = (record.itinerary ?? []).filter((s) => s && (s.name || s.sea));
  const offers = (record.offers ?? []).filter((o) => o && o.name);
  const included = (record.included ?? []).filter(Boolean);

  const where = [record.from, record.to].filter(Boolean).join(" → ");

  /*
   * The days before the ship sails.
   *
   * This is the strongest case in the app for the things-to-do layer, and the
   * one nobody sells: every voyage and every journey has a day or two at the
   * embarkation port on the front of it — Ushuaia, Reykjavík, Longyearbyen —
   * and the supplier's file covers none of them. The Guide can, with real
   * tours and private guides, so the port becomes the ask. Falls back to the
   * first landfall when the record carries no departure port, and renders
   * nothing when it carries neither.
   */
  const embark =
    record.from || stops.find((s) => !s.sea && s.name)?.name || "";
  const daysText = embark
    ? askAboutDays({ place: embark, anchor: record.title, when: "before" })
    : "";
  const meta = [
    record.operator,
    record.ship,
    record.days ? `${record.days} days` : null,
  ].filter(Boolean).join(" · ");

  return (
    <div className="jd" ref={ref} role="dialog" aria-label={record.title}>
      <div className="jd-head">
        <div>
          <h2>{record.title}</h2>
          {meta && <p className="jd-meta">{meta}</p>}
          {where && <p className="jd-where">{where}</p>}
          {record.dates && <p className="jd-dates">{record.dates}</p>}
        </div>
        <button type="button" className="jd-close" onClick={close} aria-label="Close">
          ×
        </button>
      </div>

      <div className="jd-body">
        {record.description && <p className="jd-desc">{record.description}</p>}

        {/* Offers before the itinerary: a limited-time offer is the only part
            of this file with a deadline attached to it. */}
        {offers.length > 0 && (
          <>
            <p className="jd-label">Current Offers</p>
            <ul className="jd-offers">
              {offers.map((o, i) => (
                <li key={i}>
                  <span className="jd-offer-name">
                    {o.exclusive && <span className="jd-offer-excl">Virtuoso exclusive</span>}
                    {o.name}
                  </span>
                  {o.description && <span className="jd-offer-desc">{o.description}</span>}
                  {o.endDate && <span className="jd-offer-until">Through {o.endDate}</span>}
                </li>
              ))}
            </ul>
          </>
        )}

        {stops.length > 0 && (
          <>
            <p className="jd-label">Itinerary</p>
            <ol className="jd-itin">
              {stops.map((s, i) => (
                <li key={i} className={s.sea ? "sea" : undefined}>
                  {s.day != null && <span className="jd-day">Day {s.day}</span>}
                  <span className="jd-stop">{s.sea ? "At sea" : s.name}</span>
                </li>
              ))}
            </ol>
          </>
        )}

        {included.length > 0 && (
          <>
            <p className="jd-label">Included</p>
            <ul className="jd-included">
              {included.map((x, i) => <li key={i}>{x}</li>)}
            </ul>
          </>
        )}

        {daysText && (
          <button
            type="button"
            className="jd-ask"
            onClick={() => {
              experiencesAsked("journey-dossier", embark);
              if (!askGuide(daysText, "dossier")) {
                window.location.assign(askGuideHref(daysText, "journey-dossier"));
              }
            }}
          >
            ✦ What is there to do in {embark} beforehand?
          </button>
        )}

        {record.href && (
          <a className="jd-book" href={record.href} target="_blank" rel="noopener noreferrer">
            View this journey ↗
          </a>
        )}
      </div>
    </div>
  );
}
