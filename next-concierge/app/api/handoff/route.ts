// app/api/handoff/route.ts — advisor hand-off capture.
//
// When a traveler commits at the close of a results block (e.g. "Find My Best
// Expeditions"), the client POSTs the qualified brief here. We format it into a
// readable advisor email and forward it to the lead inbox via Formspree. The
// point is reliability: this fires server-side the moment the traveler commits,
// so the advisor gets the full context even if the traveler never opens a mail
// client. The mailto path in the client stays as a convenience, not the system
// of record.
//
// Env:
//   HANDOFF_ENDPOINT (optional) — Formspree (or any JSON webhook) URL. Defaults
//     to the project's Formspree form. Swap per environment without a redeploy.

import { corsHeaders, isAllowedOrigin } from "@/lib/guide-cors";
import { isRateLimited } from "@/lib/rate-limit";
import { arrivalLabel, classifyAiSource } from "@/lib/arrival";
import { SITE_URL } from "@/lib/site-url";

export const runtime = "nodejs";
export const maxDuration = 20;

const HANDOFF_ENDPOINT =
  process.env.HANDOFF_ENDPOINT || "https://formspree.io/f/mjgdzeye";

// The structured brief the Guide qualifies during the conversation, parsed from
// the [[BRIEF: ...]] control tag on the client. Every field is optional — the
// traveler may commit before all of it is known.
interface Brief {
  destination?: string;
  when?: string;
  party?: string;
  budget?: string;
  style?: string;
  considering?: string;
}

interface HandoffBody {
  // The category that drove the close, e.g. "expedition" / "hotel" / "yacht".
  category?: string;
  // Human label of the button the traveler tapped, for the advisor's context.
  action?: string;
  // Which surface the request came from: "chat" (a shortlist is attached),
  // "header" (a cold ask with no search behind it — treat the note as the
  // whole brief) or "atlas". Changes how an advisor should open the reply.
  source?: string;
  brief?: Brief;
  // The names travelling with the request. Either the traveler's own bucket
  // list (a set of decisions, made over days) or the results they happen to be
  // looking at — `shortlistSource` says which, because an advisor opens those
  // two replies differently.
  shortlist?: string[];
  shortlistSource?: "bucket" | "results";
  // How many the list holds, when more were saved than were sent.
  shortlistTotal?: number;
  // Living Atlas deep link reproducing the exact subset on the map.
  deepLink?: string | null;
  // Lightly captured so the advisor can actually reach them.
  contact?: { name?: string; email?: string; phone?: string };
  // Optional free-text the traveler added for the advisor before handing off.
  notes?: string;
  // Full plain-text conversation, as a backstop behind the structured brief.
  transcript?: string;
  // Where the traveler was when they handed off.
  pageUrl?: string;
  // The AI assistant that first sent this traveler to the site, e.g. "chatgpt"
  // (lib/arrival.ts). Null when they did not arrive from one we recognise.
  aiSource?: string | null;
  // The page that assistant first landed them on, path only.
  aiLanding?: string | null;
}

const CATEGORY_LABEL: Record<string, string> = {
  hotel: "Luxury Hotels",
  expedition: "Expedition Cruise",
  antarctica: "Antarctica",
  jet: "Private Jet Journey",
  yacht: "Luxury Hotel Yacht",
  worldcruise: "World Cruise / Grand Voyage",
  train: "Rail Journey",
  luxurycruise: "Luxury Cruise (advisor-sourced)",
  villa: "Private Villa",
  generic: "Trip Planning",
};

function clip(s: unknown, max: number): string {
  const t = typeof s === "string" ? s.trim() : "";
  return t.length > max ? t.slice(0, max) + "…" : t;
}

/** A site path as the lead inbox may show it, or "" — never arbitrary text. */
function landingPath(s: unknown): string {
  const t = clip(s, 200);
  return /^\/[\w\-./]*$/.test(t) ? t : "";
}

function pagePath(url: unknown): string {
  try {
    return new URL(String(url)).pathname;
  } catch {
    return "";
  }
}

/**
 * A link on this site, made absolute so it is clickable in the lead email, or
 * "" for anything else. Anyone can POST here, and a link in a lead is one an
 * advisor is invited to click, so a URL on somebody else's site never reaches
 * the inbox. Relative links, which the atlas builds for some records, resolve
 * against SITE_URL rather than arriving as text nobody can click.
 */
function siteLink(raw: unknown): string {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s || s.length > 2000) return "";
  try {
    const u = new URL(s, SITE_URL);
    return u.origin === SITE_URL || isAllowedOrigin(u.origin) ? u.href : "";
  } catch {
    return "";
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

/**
 * The request body as the rest of this route uses it: every field of the type
 * it promises, already clipped — or null when the body is not an object.
 *
 * Our own client always sends the right shapes. This is for everything else
 * that can POST here: a number where a note belongs used to throw and come
 * back as a 500, and the email body took several fields at whatever length
 * they arrived. Now a wrong shape reads as absent, and nothing unbounded or
 * off-site reaches the lead inbox.
 */
function normalize(raw: unknown): HandoffBody | null {
  if (!isRecord(raw)) return null;
  const brief = isRecord(raw.brief) ? raw.brief : {};
  const contact = isRecord(raw.contact) ? raw.contact : {};
  return {
    // hasOwn, not `in`: "constructor" is in every object literal.
    category:
      typeof raw.category === "string" && Object.hasOwn(CATEGORY_LABEL, raw.category)
        ? raw.category
        : "generic",
    action: clip(raw.action, 80),
    source: clip(raw.source, 20) || "chat",
    brief: {
      destination: clip(brief.destination, 200),
      when: clip(brief.when, 120),
      party: clip(brief.party, 120),
      budget: clip(brief.budget, 120),
      style: clip(brief.style, 200),
      considering: clip(brief.considering, 400),
    },
    shortlist: Array.isArray(raw.shortlist)
      ? raw.shortlist.map((s) => clip(s, 160)).filter(Boolean).slice(0, 12)
      : [],
    shortlistSource: raw.shortlistSource === "bucket" ? "bucket" : "results",
    shortlistTotal: Number(raw.shortlistTotal) || 0,
    deepLink: siteLink(raw.deepLink) || null,
    contact: {
      name: clip(contact.name, 80),
      email: clip(contact.email, 200),
      phone: clip(contact.phone, 40),
    },
    notes: clip(raw.notes, 1000),
    transcript: clip(raw.transcript, 6000),
    pageUrl: siteLink(raw.pageUrl),
    aiSource: typeof raw.aiSource === "string" ? raw.aiSource : null,
    aiLanding: typeof raw.aiLanding === "string" ? raw.aiLanding : null,
  };
}

// What a traveler sees when the lead inbox did not take the request. The
// provider's own error text goes to the logs, not to the visitor.
const CAPTURE_FAILED = "Sorry, that didn't reach an advisor. Please try again in a moment.";

// Build the human-readable advisor email body. Lead with the structured brief
// (how to follow up) and keep the transcript at the bottom as backup context.
function composeMessage(body: HandoffBody): string {
  const b = body.brief ?? {};
  const lines: string[] = [];
  const cat = CATEGORY_LABEL[body.category ?? "generic"] ?? "Trip Planning";

  lines.push(`New hand-off from Expedition Bucket List — ${cat}`);
  if (body.action) lines.push(`Traveler tapped: ${body.action}`);
  const ai = classifyAiSource(body.aiSource);
  if (ai) {
    const landing = landingPath(body.aiLanding);
    lines.push(`Found us through: ${arrivalLabel(ai)}${landing ? ` (landed on ${landing})` : ""}`);
  }
  if (body.source === "answer") {
    const page = landingPath(pagePath(body.pageUrl));
    lines.push(`Asked from the answer page${page ? ` ${page}` : ""}.`);
  }
  if (body.source === "header") {
    // A cold request: nobody searched, so there is no shortlist and the brief
    // is mostly blank by design. Say so, rather than letting the advisor read
    // six "(not yet stated)" lines as a broken integration.
    lines.push("Cold request — asked for an advisor directly, before searching.");
  }
  lines.push("");

  lines.push("— Qualified brief —");
  lines.push(`Destination: ${b.destination || "(not yet stated)"}`);
  lines.push(`When: ${b.when || "(not yet stated)"}`);
  lines.push(`Party: ${b.party || "(not yet stated)"}`);
  lines.push(`Budget: ${b.budget || "(not yet stated)"}`);
  lines.push(`Style: ${b.style || "(not yet stated)"}`);
  lines.push(`Already considering: ${b.considering || "(none mentioned)"}`);
  lines.push("");

  if (body.notes && body.notes.trim()) {
    lines.push("— Traveler's note —");
    lines.push(clip(body.notes, 1000));
    lines.push("");
  }

  if (body.shortlist?.length) {
    const fromBucket = body.shortlistSource === "bucket";
    const sent = body.shortlist.slice(0, 12);
    lines.push(fromBucket ? "— Their bucket list —" : "— Shortlist on screen —");
    for (const name of sent) lines.push(` • ${clip(name, 160)}`);
    // Saved past what we send: say so rather than letting a list of ten read as
    // the whole of a list of twenty-six.
    const total = Number(body.shortlistTotal) || sent.length;
    if (total > sent.length) lines.push(` • …and ${total - sent.length} more saved`);
    lines.push("");
  }

  if (body.deepLink) {
    // The data layer encodes deep links against the standalone map path
    // (/maps/<type>/...); rewrite to the in-app concierge atlas route
    // (/atlas/<type>) so the advisor opens the full app, not the bare map page.
    const atlasLink = body.deepLink.replace(/\/maps\/([^/]+)\/?/, "/atlas/$1");
    lines.push("See it on the atlas:");
    lines.push(atlasLink);
    lines.push("");
  }

  if (body.transcript) {
    lines.push("— Conversation —");
    lines.push(clip(body.transcript, 6000));
  }

  return lines.join("\n");
}

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

export async function POST(req: Request) {
  const cors = corsHeaders(req);
  const limited = await isRateLimited(req, cors);
  if (limited) return limited;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json(
      { ok: false, error: "Invalid JSON." },
      { status: 400, headers: cors },
    );
  }
  const body = normalize(raw);
  if (!body) {
    return Response.json(
      { ok: false, error: "Invalid request." },
      { status: 400, headers: cors },
    );
  }

  const contact = body.contact ?? {};
  // We can capture a brief without contact, but with no way to reach the
  // traveler there is nothing for the advisor to follow up on. Require an email.
  const email = clip(contact.email, 200);
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return Response.json(
      { ok: false, error: "A valid email is required." },
      { status: 422, headers: cors },
    );
  }

  const cat = CATEGORY_LABEL[body.category ?? "generic"] ?? "Trip Planning";
  const payload = {
    _subject: `Expedition Bucket List hand-off — ${cat}${
      contact.name ? ` — ${clip(contact.name, 80)}` : ""
    }`,
    name: clip(contact.name, 80) || "(not given)",
    email,
    phone: clip(contact.phone, 40),
    notes: clip(body.notes, 1000),
    category: body.category ?? "generic",
    action: clip(body.action, 80),
    source: clip(body.source, 20) || "chat",
    destination: clip(body.brief?.destination, 200),
    when: clip(body.brief?.when, 120),
    party: clip(body.brief?.party, 120),
    budget: clip(body.brief?.budget, 120),
    style: clip(body.brief?.style, 200),
    considering: clip(body.brief?.considering, 400),
    shortlist: (body.shortlist ?? []).slice(0, 12).join(", "),
    shortlistSource: body.shortlistSource === "bucket" ? "bucket-list" : "on-screen",
    deepLink: clip(body.deepLink, 1000),
    pageUrl: clip(body.pageUrl, 500),
    // Re-classified rather than echoed, so the lead inbox only ever sees a
    // known assistant name and never whatever a caller put in the field.
    aiSource: classifyAiSource(body.aiSource) ?? "",
    aiLanding: landingPath(body.aiLanding),
    message: composeMessage(body),
  };

  try {
    const res = await fetch(HANDOFF_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`Hand-off capture failed (${res.status}):`, detail.slice(0, 500));
      return Response.json(
        { ok: false, error: CAPTURE_FAILED },
        { status: 502, headers: cors },
      );
    }
  } catch (err) {
    console.error("Hand-off capture failed:", err);
    return Response.json(
      { ok: false, error: CAPTURE_FAILED },
      { status: 502, headers: cors },
    );
  }

  return Response.json({ ok: true }, { headers: cors });
}
