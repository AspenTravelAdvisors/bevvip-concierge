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
import { campHref, type SafariCamp } from "@/lib/atlas/safari-camps";
import { stayHref, cityHref, type GatewaySide, type JourneyStays } from "@/lib/atlas/gateway-hotels";
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
  /*
   * ── The camps, safari only ───────────────────────────────────────────────
   *
   * The one field here that is not the supplier's own copy. Every other
   * collection's stops are cities and airports; a safari's stops are reserves,
   * and we sell the lodges inside them. This is that join, and it is optional
   * because six of the seven collections have nothing to put in it.
   *
   * Read lib/atlas/safari-camps.ts before changing how this renders: the data
   * supports "our camps along this route" and does NOT support "you sleep
   * here", and the difference is load-bearing.
   */
  camps?: SafariCamp[];
  /** How near a camp had to be to a stop to be listed, for the note. */
  campRadiusKm?: number | null;
  /*
   * ── The nights either side, everything except safari ─────────────────────
   *
   * The counterpart to `camps`, and the mirror image of it. A safari's stops
   * ARE beds we sell; a jet expedition's, a voyage's and a rail journey's are
   * cities, which is why those five collections had nothing to put in the
   * block above. What they do have is a first stop and a last stop — nobody
   * flies in on the morning of embarkation — and those two nights are the part
   * of the journey the supplier's file never covers and we can book outright.
   *
   * Read lib/atlas/gateway-hotels.ts before changing how this renders: the
   * data supports "where to stay before" and does NOT support "this night is
   * included", and the difference is load-bearing.
   */
  stays?: JourneyStays | null;
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
  const camps = record.camps ?? [];
  const stays = record.stays ?? null;
  const radius = record.campRadiusKm ?? 25;
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

  /*
   * Did the supplier's prose arrive cut short?
   *
   * The sync clips a description to 700 characters on a word boundary and
   * closes it with an ellipsis (`clip` in lib/virtuoso/text.mjs), and on the
   * shipped cruise feed 2,921 of 4,311 sailings are long enough to be cut. The
   * ellipsis is honest and, in this panel, misleading: the next thing under it
   * is the Current Offers heading, so a paragraph that stops mid-sentence
   * reads as the end of the file rather than as the middle of a page. Where
   * the feed gives us somewhere to send the reader, the cut gets a
   * destination — the supplier's own listing, which is where the rest of the
   * prose is and which the card beside this panel already links to under the
   * same words.
   */
  const clipped = /\u2026\s*$/.test(record.description || "");

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
        {clipped && record.href && (
          <a
            className="jd-more"
            href={record.href}
            target="_blank"
            rel="noopener noreferrer"
          >
            View details ↗
          </a>
        )}

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

        {camps.length > 0 && (
          <>
            <p className="jd-label">Our Camps Along This Route</p>
            {/* The claim, stated. Without it a reader takes the list for the
                booked accommodation, which the tour feed never tells us. */}
            <p className="jd-camps-note">
              Properties we hold VIP perks on, within {radius}km of this
              itinerary&rsquo;s stops. Which camp a departure uses is set by the
              operator &mdash; ask and we will confirm it.
            </p>
            <ul className="jd-camps">
              {camps.map((c) => (
                <li key={c.id}>
                  <a href={campHref(c)} className="jd-camp">
                    {c.thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.thumb} alt="" loading="lazy" />
                    ) : (
                      <span className="jd-camp-empty" />
                    )}
                    <span className="jd-camp-text">
                      <span className="jd-camp-name">{c.name}</span>
                      <span className="jd-camp-meta">
                        {[
                          c.house,
                          c.day != null ? `Day ${c.day}` : null,
                          c.stop ? `near ${c.stop}` : null,
                          c.rooms ? `${c.rooms} rooms` : null,
                        ].filter(Boolean).join(" · ")}
                      </span>
                      {c.perks.length > 0 && (
                        <span className="jd-camp-perks">{c.perks.join(" · ")}</span>
                      )}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </>
        )}

        {stays && (
          <>
            {/* One label for the block, and a caption per end inside it. The
                dossier's other sections are one heading over one list; this is
                one subject — the nights either side — that happens to have two
                halves, and heading it twice made the panel read as two
                unrelated offers. */}
            <p className="jd-label">Where to Stay Before &amp; After</p>
            {/* The claim, stated once — as it is over the camps, and once
                rather than over each list, because a caveat printed twice in
                one panel reads as boilerplate instead of as the caveat it is.
                Without it a reader takes the list for the operator's own
                pre-tour hotel, which some fares do include and no feed names. */}
            <p className="jd-stays-note">
              Where this journey begins and ends, the hotels we hold VIP perks on
              within {stays.radiusKm}km. The nights either side are not part of
              the fare &mdash; we book them alongside it.
            </p>
            {/* One list for a round trip: "Before & after — Venice" is the true
                statement for a voyage that returns to its berth, and the same
                three hotels printed twice is the false-looking one. */}
            {stays.sameEnds && stays.pre ? (
              <StaySection caption={"Before & after"} side={stays.pre} stays={stays} />
            ) : (
              <>
                {stays.pre && <StaySection caption="Before" side={stays.pre} stays={stays} />}
                {stays.post && <StaySection caption="After" side={stays.post} stays={stays} />}
              </>
            )}
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

/**
 * One end of a journey, as a list of beds.
 *
 * Deliberately the same shape as the camps list above it — thumbnail, name,
 * one meta line, the perks — because they are the same object arriving from
 * the same atlas, and a reader who has learned to read one row should not have
 * to learn a second. What differs is the claim in the note, and the flag: a
 * row from the journey's OWN house is first in the list, and says why.
 */
function StaySection({
  caption,
  side,
  stays,
}: {
  caption: string;
  side: GatewaySide;
  stays: JourneyStays;
}) {
  const city = side.stays.find((s) => s.city)?.city ?? null;
  const more = cityHref(city);
  return (
    <>
      <p className="jd-stays-side">
        {caption}
        {side.place ? ` — ${side.place}` : ""}
      </p>
      <ul className="jd-stays">
        {side.stays.map((h) => (
          <li key={h.id}>
            <a href={stayHref(h)} className={`jd-stay${h.sameHouse ? " jd-stay--house" : ""}`}>
              {h.thumb ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={h.thumb} alt="" loading="lazy" />
              ) : (
                <span className="jd-stay-empty" />
              )}
              <span className="jd-stay-text">
                <span className="jd-stay-name">
                  {/* Why this row is first, and NOT the house's name: the name
                      is already the first two words of nearly every hotel this
                      flag lands on — "Four Seasons  Four Seasons Hotel
                      Bangkok", "Orient Express  Orient Express Venezia" — so
                      naming the house here says the same thing twice and says
                      nothing about the relation. The relation is the news. */}
                  {h.sameHouse && stays.house && (
                    <span className="jd-stay-flag" title={`Also ${stays.house}`}>
                      Same house
                    </span>
                  )}
                  {h.name}
                </span>
                <span className="jd-stay-meta">
                  {[
                    h.city,
                    `${h.km < 1 ? "under 1" : Math.round(h.km)}km away`,
                    h.rooms ? `${h.rooms} rooms` : null,
                  ].filter(Boolean).join(" · ")}
                </span>
                {h.perks.length > 0 && (
                  <span className="jd-stay-perks">{h.perks.join(" · ")}</span>
                )}
              </span>
            </a>
          </li>
        ))}
      </ul>
      {more && (
        <a className="jd-stays-more" href={more}>
          Every hotel we hold in {city} ↗
        </a>
      )}
    </>
  );
}
