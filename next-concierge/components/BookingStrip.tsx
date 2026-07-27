"use client";

// BookingStrip — where / when / who capture (BOOKING-SPEC §2).
//
// No longer the front door. It used to render unprompted on the empty state,
// the largest and most search-engine-looking control on the page, and it always
// composed "VIP hotels in {destination}" — so a visitor who typed "Antarctica"
// into a box flanked by check-in and check-out dates got a hotel search for
// Antarctica. In a seven-collection concierge, the most prominent control was
// silently a hotel filter.
//
// Two changes: it now sits behind "Have dates and a party size? Add them", and
// the ask it composes names no category at all. The Guide routes it, which is
// the entire reason the Guide exists.
//
// Submit still does two things in order: persist the shared trip state, then
// compose a plain natural-language ask and hand it to the Guide's existing
// send(). It never posts a hidden payload — the transcript stays honest and
// editable — and it never blocks a traveler who has no dates yet.

import { useMemo, useState } from "react";
import type { TripState } from "@/lib/types";
import { setTrip } from "@/lib/trip-state";

const MAX_ADULTS = 12;
const MAX_CHILDREN = 8;
const DEFAULT_CHILD_AGE = 10;

// Next calendar day as YYYY-MM-DD, for the check-out minimum.
function nextDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

const todayISO = () => new Date().toISOString().slice(0, 10);

// The plain-language ask handed to the Guide. Mirrors the traveler's own words
// so it reads naturally in the transcript and stays re-askable.
//
// Deliberately category-free. This used to open with "VIP hotels in …", which
// meant the strip decided what kind of trip you were taking before you had said
// anything — and decided wrong for six of the seven collections.
function composeAsk(t: {
  destination: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  childrenAges: number[];
}): string {
  const parts = [t.destination.trim()];
  if (t.checkIn && t.checkOut) parts.push(`${t.checkIn} to ${t.checkOut}`);
  else if (t.checkIn) parts.push(`around ${t.checkIn}`);
  const who: string[] = [`${t.adults} ${t.adults === 1 ? "adult" : "adults"}`];
  if (t.childrenAges.length) {
    who.push(
      `${t.childrenAges.length} ${t.childrenAges.length === 1 ? "child" : "children"} (ages ${t.childrenAges.join(", ")})`,
    );
  }
  parts.push(`for ${who.join(" and ")}`);
  return parts.join(", ");
}

export default function BookingStrip({
  onSearch,
  initial,
  compact = false,
  onCancel,
}: {
  onSearch: (ask: string) => void;
  initial?: TripState | null;
  compact?: boolean;
  onCancel?: () => void;
}) {
  const [destination, setDestination] = useState(initial?.destination ?? "");
  const [checkIn, setCheckIn] = useState(initial?.checkIn ?? "");
  const [checkOut, setCheckOut] = useState(initial?.checkOut ?? "");
  const [adults, setAdults] = useState(initial?.adults ?? 2);
  const [childrenAges, setChildrenAges] = useState<number[]>(initial?.childrenAges ?? []);
  const [error, setError] = useState("");

  const checkOutMin = useMemo(() => (checkIn ? nextDay(checkIn) : todayISO()), [checkIn]);

  const setChildCount = (n: number) => {
    const next = Math.max(0, Math.min(MAX_CHILDREN, n));
    setChildrenAges((prev) => {
      if (next === prev.length) return prev;
      if (next < prev.length) return prev.slice(0, next);
      return [...prev, ...Array(next - prev.length).fill(DEFAULT_CHILD_AGE)];
    });
  };

  const setChildAge = (i: number, age: number) =>
    setChildrenAges((prev) => prev.map((a, j) => (j === i ? age : a)));

  const submit = () => {
    const dest = destination.trim();
    if (!dest) {
      setError("Add a destination — a region, a city, or a hotel name.");
      return;
    }
    // If only one date is set, drop it: an open-ended range is not a real stay.
    const ci = checkIn && checkOut ? checkIn : "";
    const co = checkIn && checkOut ? checkOut : "";
    setTrip(
      { destination: dest, checkIn: ci || null, checkOut: co || null, adults, childrenAges },
      "strip",
    );
    onSearch(composeAsk({ destination: dest, checkIn: ci, checkOut: co, adults, childrenAges }));
  };

  return (
    <div className={`booking-strip${compact ? " compact" : ""}`}>
      <div className="bs-fields">
        <label className="bs-field bs-where">
          <span className="bs-label">Where</span>
          <input
            type="text"
            placeholder="Caribbean, Antarctica, Japan, a hotel name…"
            value={destination}
            onChange={(e) => {
              setDestination(e.target.value);
              if (error) setError("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
          />
        </label>

        <label className="bs-field">
          <span className="bs-label">Check-in</span>
          <input
            type="date"
            min={todayISO()}
            value={checkIn}
            onChange={(e) => {
              setCheckIn(e.target.value);
              // keep check-out valid relative to the new check-in
              if (checkOut && e.target.value && checkOut <= e.target.value) setCheckOut("");
            }}
          />
        </label>

        <label className="bs-field">
          <span className="bs-label">Check-out</span>
          <input
            type="date"
            min={checkOutMin}
            value={checkOut}
            onChange={(e) => setCheckOut(e.target.value)}
          />
        </label>
      </div>

      <div className="bs-guests">
        <Stepper
          label={adults === 1 ? "adult" : "adults"}
          value={adults}
          min={1}
          max={MAX_ADULTS}
          onChange={setAdults}
        />
        <Stepper
          label={childrenAges.length === 1 ? "child" : "children"}
          value={childrenAges.length}
          min={0}
          max={MAX_CHILDREN}
          onChange={setChildCount}
        />
        {childrenAges.length > 0 && (
          <div className="bs-ages">
            {childrenAges.map((age, i) => (
              <label key={i} className="bs-age">
                <span>Age</span>
                <select value={age} onChange={(e) => setChildAge(i, Number(e.target.value))}>
                  {Array.from({ length: 18 }, (_, a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        )}
      </div>

      {error && <div className="bs-error">{error}</div>}

      <div className="bs-actions">
        {/* "See VIP rates" promised a rate page this button has never opened —
            it hands an ask to the Guide. Say that. */}
        <button type="button" className="bs-submit" onClick={submit}>
          Find options
        </button>
        {onCancel && (
          <button type="button" className="bs-cancel" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

function Stepper({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="bs-stepper">
      <button
        type="button"
        aria-label={`Fewer ${label}`}
        disabled={value <= min}
        onClick={() => onChange(value - 1)}
      >
        −
      </button>
      <span className="bs-count">
        {value} {label}
      </span>
      <button
        type="button"
        aria-label={`More ${label}`}
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
      >
        +
      </button>
    </div>
  );
}
