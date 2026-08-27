/**
 * Asking The Guide about a specific thing, from anywhere in the app.
 *
 * Two problems this fixes, both of which made the atlases feel like a different
 * product from the chat.
 *
 * **1. Most surfaces had no ask at all.** The photoreal property view — the
 * deepest, most persuasive screen in the product — offered "Search VIP rates"
 * and a mailto, while its own intro tour promised "Send any hotel to The Guide
 * for a tailored shortlist". The hotel pin popups and the Guide's own
 * recommendation popups offered nothing. Villas kept theirs ("Ask the Guide
 * about this villa") and read the better for it.
 *
 * **2. The one ask that survived threw the context away.** The collection card
 * sent `/?ask=<title> (listing: <url>)` — a name and nothing else. The Guide
 * then had to re-derive the city, the country, the program and the benefits it
 * had just been looking at, or ask the traveller to repeat themselves. A
 * question about a hotel should arrive knowing which hotel.
 *
 * So: one builder for the text, one door for the send. The text names the
 * property the way a person would, and carries the facts the answer depends on.
 */

import type { AskSource } from "@/lib/analytics";

/** Everything worth telling The Guide about a property being asked about. */
export interface AskSubject {
  name: string;
  city?: string | null;
  country?: string | null;
  region?: string | null;
  /** "Beach Resort", "City Hotel" — the atlas's own category. */
  category?: string | null;
  /** The preferred-partner program: Virtuoso, Marriott STARS, … */
  program?: string | null;
  brand?: string | null;
  /** A listing or detail URL, when one exists. */
  url?: string | null;
  /** VIP benefits already on screen, so the answer can build on them. */
  benefits?: string[] | null;
}

function place(s: AskSubject): string {
  return [s.city, s.region && s.region !== s.city ? s.region : null, s.country]
    .filter(Boolean)
    .join(", ");
}

/**
 * The question a traveller would actually ask, given what they are looking at.
 *
 * Deliberately a QUESTION and not a dump of fields. The Guide reads this as a
 * turn in a conversation, so a labelled record ("name: X, city: Y") makes it
 * answer like a database. The facts are carried inside an ordinary sentence,
 * which is also what the traveller sees echoed in the chat — and seeing your
 * own question there, phrased the way you would phrase it, is most of why the
 * hand-off feels like one product.
 */
export function askAboutProperty(s: AskSubject): string {
  const where = place(s);
  const parts: string[] = [`Tell me about ${s.name}`];
  if (where) parts.push(` in ${where}`);
  parts.push(".");

  const facts: string[] = [];
  if (s.category) facts.push(`It's listed as ${s.category.toLowerCase()}`);
  if (s.program) facts.push(`booked through ${s.program}`);
  if (s.brand && s.brand !== s.program) facts.push(`part of ${s.brand}`);
  if (facts.length) parts.push(` ${facts.join(", ")}.`);

  if (s.benefits?.length) {
    // Three is enough to anchor the answer; the whole list turns a question
    // into a paste.
    parts.push(` The VIP benefits shown are: ${s.benefits.slice(0, 3).join("; ")}.`);
  }

  parts.push(
    " Is it a good fit for my trip, what should I know about the rooms and the setting, and what would you compare it with nearby?",
  );
  if (s.url) parts.push(` (Listing: ${s.url})`);
  return parts.join("");
}

/** The lighter version, for a map pin where only the headline facts are loaded. */
export function askAboutPin(s: AskSubject): string {
  const where = place(s);
  return (
    `Tell me about ${s.name}${where ? ` in ${where}` : ""}.` +
    " What is it like, who is it right for, and what are the VIP benefits?"
  );
}

/* ── Delivery ───────────────────────────────────────────────────────────────
 *
 * The Guide lives on the home page, and until now every ask from an atlas was a
 * navigation: `/?ask=…`, which unloads the map, the filters and the camera to
 * ask a question about them. That is the cost that made "ask" feel like leaving
 * rather than like talking.
 *
 * Where a chat is mounted on the current page (see components/AtlasGuideDock),
 * the ask is delivered in place through the event bus GuideChat already
 * listens on. Where one is not, the navigation is still there — it is the
 * fallback now, not the mechanism.
 */

let hosts = 0;

/** A mounted chat claims asks on this page for as long as it lives. */
export function registerGuideHost(): () => void {
  hosts += 1;
  return () => {
    hosts = Math.max(0, hosts - 1);
  };
}

export function guideHostActive(): boolean {
  return hosts > 0;
}

/**
 * Send a question to The Guide.
 *
 * Returns true when it was delivered in place. False means no chat is mounted
 * here and the caller should navigate — done by the caller rather than here so
 * that React surfaces can use the router (client-side, keeps the back button
 * honest) while the raw-HTML map popups can use a plain href.
 */
export function askGuide(text: string, source: AskSource = "dock"): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (!guideHostActive()) return false;
  window.dispatchEvent(
    new CustomEvent("bevvip:guide-ask", { detail: { text: trimmed, source } }),
  );
  // The dock listens for this to open itself: a question sent to a chat nobody
  // can see is the same as no answer at all.
  window.dispatchEvent(new Event("bevvip:guide-open"));
  return true;
}

/** The navigation fallback, for surfaces with no chat mounted. */
export function askGuideHref(text: string, src: string): string {
  return `/?ask=${encodeURIComponent(text.trim())}&src=${encodeURIComponent(src)}`;
}

/* ── The bucket list ────────────────────────────────────────────────────────
 *
 * A saved item is the thinnest subject in the app: title, a where/when line and
 * maybe a brand, copied in at save time (see lib/bucket-list for why it is
 * denormalized). It has no `city`/`country`/`category` to compose a question
 * from, so `place()` cannot be used — passing a villa's "Mustique · Sleeps 8 ·
 * from $14,000/wk" as a region would produce a sentence nobody wrote.
 *
 * Instead the line is carried as context, in the traveller's own reading of it.
 */

export function askAboutSaved(s: { title: string; subtitle?: string | null; brand?: string | null }): string {
  const detail = [s.subtitle, s.brand && s.brand !== s.subtitle ? s.brand : null]
    .filter(Boolean)
    .join(" · ");
  return (
    `Tell me about ${s.title}${detail ? ` (${detail})` : ""}, which I've saved to my bucket list.` +
    " What is it like, who is it right for, and what should I know before I commit?"
  );
}

/**
 * The question the LIST asks, which no single item can.
 *
 * The reason to keep several things in one place is to compare them, and by
 * the time someone has saved four they are choosing, not browsing. Capped
 * because a question naming twenty properties is a spreadsheet.
 */
export function askAboutBucketList(titles: string[]): string {
  const named = titles.slice(0, 8);
  const rest = titles.length - named.length;
  return (
    `These are on my bucket list: ${named.join("; ")}${rest > 0 ? `, and ${rest} more` : ""}.` +
    " How do they compare, which would you put together into one trip, and what would you do first?"
  );
}
