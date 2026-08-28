"use client";

/**
 * The property dossier — everything the atlas knows about one hotel.
 *
 * This content existed in exactly one place: the detail panel inside
 * `public/maps/hotel/index.html`. That is why "See it in 3D" undersold itself
 * and why the card action had to be renamed "Property details & 3D" — the
 * photoreal building was the advertised half of a panel whose real value is the
 * description, the ratings, the address, the program, the VIP benefit list and
 * the rate access code.
 *
 * Porting the engine into the shell without porting this would have moved the
 * picture and left the substance in the iframe. So: the same fields, in the
 * same order, from the same endpoint (`/api/hotel/luxury-hotels/:id`), rendered
 * beside either engine.
 *
 * One thing is deliberately NOT the same. The original panel's only forward
 * steps were "Search VIP rates" and a mailto to the concierge — no way to ask
 * about the property you were looking at, on the screen where you had the most
 * questions. The intro tour promised that ask; the panel never had it. It does
 * now.
 */

import { useEffect, useState } from "react";
import { bookingLink } from "@/lib/atlas/booking.js";
import { getTrip, onTrip } from "@/lib/trip-state";
import { programDomain } from "@/lib/atlas/adapters/hotel-programs";
import { hotelBrandDomain } from "@/lib/atlas/adapters/hotel-brands";
import { askAboutDays, askAboutProperty, askGuide, askGuideHref } from "@/lib/atlas/ask";
import { bookingClicked, experiencesAsked } from "@/lib/analytics";
import { openAdvisor, ADVISOR_CTA_COLD } from "./AdvisorRequest";
import BucketListButton from "./BucketListButton";
import type { TripState } from "@/lib/types";

/** The subset of a hotel record this panel renders. */
interface HotelRecord {
  id: string;
  name?: string;
  brand?: string | null;
  program?: string | null;
  category?: string | null;
  country?: string | null;
  city?: string | null;
  address?: string | null;
  adminRegion?: string | null;
  vipUpgrades?: string[] | null;
  bookUrl?: string | null;
  bookPassword?: string | null;
  tw?: { hotelId?: string | number; lat?: number; lon?: number; label?: string } | null;
  /** Virtuoso's editorial copy and insider note, and the room breakdown. */
  description?: string | null;
  inTheKnow?: string | null;
  rooms?: { name?: string | null; description?: string | null }[] | null;
  roomTypeCount?: number | null;
  perksYear?: number | null;
  perksStale?: boolean | null;
  /** Live Virtuoso offers on this property, soonest to expire first. */
  promotions?: { id?: string; name?: string | null; endDate?: string | null; exclusive?: boolean; description?: string | null }[] | null;
  fit?: {
    description?: string | null;
    forbesRating?: number | string | null;
    aaaDiamondRating?: number | string | null;
  } | null;
}

/**
 * The dataset prefixes every blurb with the property's own name ("The Little
 * Nell: a city stay…"). Drop it — it is already the panel's title — and
 * recapitalize what remains so it still reads as a sentence.
 */
function cleanDescription(raw: string | null | undefined): string {
  let text = String(raw || "").trim();
  const colon = text.indexOf(": ");
  if (colon > 0 && colon < 90) {
    text = text.slice(colon + 2).replace(/^./, (c) => c.toUpperCase());
  }
  return text;
}

/**
 * Year headers ("For 2026:") are labels in the source data, not benefits.
 * The original filtered them out of the list; so does this.
 */
const YEAR_HEADER = /^for\s+20\d{2}(\s*&\s*20\d{2})?\s*:?\s*$/i;

function benefitList(raw: string[] | null | undefined): string[] {
  return (raw || []).map((u) => String(u ?? "").trim()).filter((u) => u && !YEAR_HEADER.test(u));
}

/**
 * "First Priority" is italic; "Room Upgrade" stays upright. Source lines start
 * with a bare "Upgrade…", so "Room" is inserted when it isn't already there —
 * verbatim from the original's formatVipBenefit.
 */
function renderBenefit(raw: string): React.ReactNode {
  const text = raw.trim();
  const stripped = text.replace(/^["']?first priority["']?\s*/i, "");
  if (/^room\s+upgrades?\b/i.test(stripped)) {
    return (
      <>
        <em>First Priority</em> {stripped}
      </>
    );
  }
  if (/^upgrades?\b/i.test(stripped)) {
    return (
      <>
        <em>First Priority</em> Room {stripped}
      </>
    );
  }
  return text;
}

function logoFor(record: HotelRecord): string | null {
  const domain =
    hotelBrandDomain(record.brand || "") || programDomain(record.program || "") || null;
  // Google's favicon service — Clearbit's logo API was sunset after the HubSpot
  // acquisition, and this is the same source the standalone atlas uses.
  return domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=64` : null;
}

export default function HotelDossier({
  id,
  fallbackName,
  onClose,
}: {
  id: string;
  /** Shown while the record loads, so the panel never opens empty. */
  fallbackName?: string;
  onClose: () => void;
}) {
  const [record, setRecord] = useState<HotelRecord | null>(null);
  const [failed, setFailed] = useState(false);
  const [trip, setTripState] = useState<TripState | null>(null);

  useEffect(() => {
    setTripState(getTrip());
    return onTrip(setTripState);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setRecord(null);
    setFailed(false);
    fetch(`/api/hotel/luxury-hotels/${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: HotelRecord) => {
        if (!cancelled) setRecord(j);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const name = record?.name || fallbackName || "Property";
  const where = [record?.city, record?.adminRegion, record?.country].filter(Boolean).join(", ");
  const benefits = benefitList(record?.vipUpgrades);
  /*
   * Virtuoso's editorial copy first, the old AI blurb only as a fallback.
   *
   * `fit.description` was model-written, the same vintage as the categories
   * that filed 73% of the inventory under "City Hotel". The supplier text is
   * written by Virtuoso's travel desk and covers 2,071 of 2,073 properties, so
   * the fallback now only catches the non-Virtuoso partners.
   */
  const description = record?.description || cleanDescription(record?.fit?.description);
  const inTheKnow = record?.inTheKnow || null;
  const rooms = (record?.rooms || []).filter((r) => r && r.name);
  const offers = (record?.promotions || []).filter((o) => o && o.name);
  const forbes = record?.fit?.forbesRating;
  const aaa = record?.fit?.aaaDiamondRating;
  const logo = record ? logoFor(record) : null;

  const booking = record
    ? bookingLink(
        {
          type: "hotel",
          id: record.id,
          name: record.name,
          ...(record.tw ? { tw: record.tw } : {}),
          ...(record.bookUrl ? { bookUrl: record.bookUrl } : {}),
          ...(record.bookPassword ? { bookPassword: record.bookPassword } : {}),
        },
        trip,
      )
    : null;

  /*
   * The other question a traveller has on this screen.
   *
   * "Tell me about this hotel" is the one the dossier already answers; "and
   * what would we do with the days?" is the one it has never offered, though
   * the Guide can answer it with real tours and private guides. The city is
   * right here, which is exactly what that lookup needs, so the ask goes out
   * fully formed rather than making someone retype a place the page knows.
   * Hidden when the record has no city to name.
   */
  const daysPlace = record?.city || record?.adminRegion || "";
  const daysText = daysPlace
    ? askAboutDays({
        place: daysPlace,
        country: record?.country,
        anchor: name,
        when: "around",
      })
    : "";

  const askText = askAboutProperty({
    name,
    city: record?.city,
    country: record?.country,
    region: record?.adminRegion,
    category: record?.category,
    program: record?.program,
    brand: record?.brand,
    benefits,
  });

  return (
    <aside className="hotel-dossier" aria-label={`${name} — property details`}>
      <header>
        <div className="hd-head">
          {record?.category && <p className="hd-cat">{record.category}</p>}
          <h2>{name}</h2>
          {where && <p className="hd-where">{where}</p>}
        </div>
        <button type="button" className="hd-close" onClick={onClose} aria-label="Close details">
          ✕
        </button>
      </header>

      {failed && (
        <p className="hd-empty">
          The full profile could not be loaded just now. The property is still on the map, and The
          Guide can tell you about it.
        </p>
      )}

      {!record && !failed && <p className="hd-empty">Opening the property file…</p>}

      {record && (
        <div className="hd-body">
          {description && <p className="hd-desc">{description}</p>}
          {/* Virtuoso's one-line insider note — the detail an advisor would
              actually lead with, and the closest the feed comes to a voice. */}
          {inTheKnow && <p className="hd-know"><span>In the know</span> {inTheKnow}</p>}

          {(forbes || aaa) && (
            <div className="hd-ratings">
              {forbes && (
                <span className="hd-rating">
                  <span aria-hidden="true">★</span> Forbes {forbes} Star
                </span>
              )}
              {aaa && (
                <span className="hd-rating">
                  <span aria-hidden="true">◆</span> AAA {aaa} Diamond
                </span>
              )}
            </div>
          )}

          <dl className="hd-rows">
            <div>
              <dt>Address</dt>
              <dd>{record.address || "—"}</dd>
            </div>
            <div>
              <dt>Program</dt>
              <dd>
                {record.program ? (
                  <span className="hd-prog">
                    {logo && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={logo}
                        alt=""
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display = "none";
                        }}
                      />
                    )}
                    {record.program}
                  </span>
                ) : (
                  "—"
                )}
              </dd>
            </div>
          </dl>

          {/* The money-maker sits directly under Address/Program so it never
              falls below the fold — the original's placement, for the original's
              reason. */}
          {booking?.url && (
            <a
              className="hd-book"
              href={booking.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => bookingClicked("hotel", !booking.needsDates)}
            >
              {booking.label} ↗
            </a>
          )}
          {booking?.note && <p className="hd-code">{booking.note}</p>}

          {offers.length > 0 && (
            <>
              <p className="hd-label">Current Offers</p>
              <ul className="hd-offers">
                {offers.map((o, i) => (
                  <li key={o.id ?? i}>
                    <span className="hd-offer-name">
                      {o.exclusive && <span className="hd-offer-excl">Virtuoso exclusive</span>}
                      {o.name}
                    </span>
                    {o.description && <span className="hd-offer-desc">{o.description}</span>}
                    {/* An offer without its expiry is an offer nobody can act
                        on with confidence. */}
                    {o.endDate && <span className="hd-offer-until">Through {o.endDate}</span>}
                  </li>
                ))}
              </ul>
            </>
          )}

          {rooms.length > 0 && (
            <>
              <p className="hd-label">
                Rooms &amp; Suites
                {/* The feed caps the list; say so rather than implying these
                    are all of them. */}
                {record?.roomTypeCount && record.roomTypeCount > rooms.length ? (
                  <span className="hd-roomcount"> {rooms.length} of {record.roomTypeCount}</span>
                ) : null}
              </p>
              <ul className="hd-rooms">
                {rooms.map((r, i) => (
                  <li key={i}>
                    <span className="hd-room-name">{r.name}</span>
                    {r.description ? <span className="hd-room-desc">{r.description}</span> : null}
                  </li>
                ))}
              </ul>
            </>
          )}

          {benefits.length > 0 && (
            <>
              <p className="hd-label">
                VIP Upgrades
                {/* Benefit blocks are written per year and 157 properties are
                    still on an old one. Better to date it than to let an
                    advisor quote a lapsed benefit. */}
                {record?.perksYear ? (
                  <span className={record?.perksStale ? "hd-perkyear stale" : "hd-perkyear"}>
                    {" "}for {record.perksYear}
                  </span>
                ) : null}
              </p>
              <ul className="hd-ups">
                {benefits.map((b, i) => (
                  <li key={i}>{renderBenefit(b)}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {/*
        The two human paths out, which this panel has never had.

        Ask goes to The Guide with the property's own facts attached (see
        lib/atlas/ask) — in place when a chat is mounted on this page, and by
        navigation when one is not. Talk to an advisor is the same door the
        header offers, put where the questions actually occur.
      */}
      <footer className="hd-actions">
        {/*
          Keep it, first.

          The dossier is where the property is actually decided — the
          description, the ratings, the VIP benefits and the photoreal building
          are all here — and until now the only ways out of that decision were
          to ask a question or to summon a human. "I want this one, later" had
          nowhere to go.
        */}
        <BucketListButton
          variant="quiet"
          source="dossier"
          className="hd-save"
          item={{
            type: "hotel",
            id,
            title: name,
            subtitle: where || null,
            brand: record?.program || record?.brand || null,
            thumb: null,
            href: `/atlas/hotel?hotel=${encodeURIComponent(id)}`,
            url: record?.bookUrl ?? null,
          }}
        />
        <button
          type="button"
          className="hd-ask"
          onClick={() => {
            if (!askGuide(askText, "dossier")) {
              window.location.assign(askGuideHref(askText, "hotel-dossier"));
            }
          }}
        >
          ✦ Ask The Guide about this hotel
        </button>
        {daysText && (
          <button
            type="button"
            className="hd-days"
            onClick={() => {
              experiencesAsked("hotel-dossier", daysPlace);
              if (!askGuide(daysText, "dossier")) {
                window.location.assign(askGuideHref(daysText, "hotel-dossier"));
              }
            }}
          >
            What is there to do in {daysPlace}?
          </button>
        )}
        <button
          type="button"
          className="hd-advisor"
          onClick={() => openAdvisor({ source: "atlas" })}
        >
          {ADVISOR_CTA_COLD}
        </button>
      </footer>
    </aside>
  );
}
