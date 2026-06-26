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

import { corsHeaders } from "@/lib/guide-cors";
import { isRateLimited } from "@/lib/rate-limit";

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
  brief?: Brief;
  // Curated shortlist names the traveler is looking at (from the result cards).
  shortlist?: string[];
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
}

const CATEGORY_LABEL: Record<string, string> = {
  hotel: "Luxury Hotels",
  expedition: "Expedition Cruise",
  antarctica: "Antarctica",
  jet: "Private Jet Journey",
  yacht: "Luxury Hotel Yacht",
  worldcruise: "World Cruise / Grand Voyage",
  generic: "Trip Planning",
};

function clip(s: unknown, max: number): string {
  const t = typeof s === "string" ? s.trim() : "";
  return t.length > max ? t.slice(0, max) + "…" : t;
}

// Build the human-readable advisor email body. Lead with the structured brief
// (how to follow up) and keep the transcript at the bottom as backup context.
function composeMessage(body: HandoffBody): string {
  const b = body.brief ?? {};
  const lines: string[] = [];
  const cat = CATEGORY_LABEL[body.category ?? "generic"] ?? "Trip Planning";

  lines.push(`New hand-off from Base Camp — ${cat}`);
  if (body.action) lines.push(`Traveler tapped: ${body.action}`);
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
    lines.push("— Shortlist on screen —");
    for (const name of body.shortlist.slice(0, 8)) lines.push(` • ${name}`);
    lines.push("");
  }

  if (body.deepLink) {
    lines.push("See it on the Atlas:");
    lines.push(body.deepLink);
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
  const limited = isRateLimited(req, cors);
  if (limited) return limited;

  let body: HandoffBody;
  try {
    body = (await req.json()) as HandoffBody;
  } catch {
    return Response.json(
      { ok: false, error: "Invalid JSON." },
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
    _subject: `Base Camp hand-off — ${cat}${
      contact.name ? ` — ${clip(contact.name, 80)}` : ""
    }`,
    name: clip(contact.name, 80) || "(not given)",
    email,
    phone: clip(contact.phone, 40),
    notes: clip(body.notes, 1000),
    category: body.category ?? "generic",
    action: clip(body.action, 80),
    destination: clip(body.brief?.destination, 200),
    when: clip(body.brief?.when, 120),
    party: clip(body.brief?.party, 120),
    budget: clip(body.brief?.budget, 120),
    style: clip(body.brief?.style, 200),
    considering: clip(body.brief?.considering, 400),
    shortlist: (body.shortlist ?? []).slice(0, 8).join(", "),
    deepLink: clip(body.deepLink, 1000),
    pageUrl: clip(body.pageUrl, 500),
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
      return Response.json(
        { ok: false, error: `Capture failed (${res.status}). ${detail.slice(0, 200)}` },
        { status: 502, headers: cors },
      );
    }
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : "Capture failed." },
      { status: 502, headers: cors },
    );
  }

  return Response.json({ ok: true }, { headers: cors });
}
