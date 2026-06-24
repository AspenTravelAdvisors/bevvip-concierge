// app/api/shortlist-email/route.ts — self-serve "Email me my shortlist".
//
// The traveler enters their address in the Guide and we email them their own
// shortlist immediately via Resend, with BeVvip BCC'd so we're copied in the
// background (no mail client, no cold call). This is transactional delivery TO
// the traveler — distinct from /api/handoff, which captures an advisor lead.
//
// Env:
//   RESEND_API_KEY (required) — Resend API key.
//   SHORTLIST_FROM (optional)  — verified sender, e.g. "BeVvip <hello@bevvip.com>".
//     Defaults to onboarding@resend.dev so dev works before a domain is verified;
//     set a verified address in production or delivery will be rejected.
//   SHORTLIST_BCC (optional)   — where our copy lands. Defaults to Book@BeVvip.com.

import { Resend } from "resend";
import { corsHeaders } from "@/lib/guide-cors";
import { isRateLimited } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 20;

const FROM = process.env.SHORTLIST_FROM || "BeVvip <onboarding@resend.dev>";
const BCC = process.env.SHORTLIST_BCC || "Book@BeVvip.com";

interface ShortlistBody {
  // Curated shortlist names the traveler is looking at (from the result cards).
  shortlist?: string[];
  // Living Atlas deep link reproducing the exact subset on the map.
  deepLink?: string | null;
  // The traveler's address — both recipient and lead.
  email?: string;
  // Where the traveler was when they asked for the shortlist.
  pageUrl?: string;
}

function clip(s: unknown, max: number): string {
  const t = typeof s === "string" ? s.trim() : "";
  return t.length > max ? t.slice(0, max) + "…" : t;
}

// Minimal HTML escaping so a stray quote in a property name can't break markup.
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function plainBody(names: string[], deepLink: string): string {
  const lines: string[] = ["Here is the shortlist we put together:", ""];
  if (names.length) for (const n of names) lines.push(` • ${n}`);
  else lines.push(" • (we'll follow up with the details we discussed)");
  if (deepLink) lines.push("", `See them on the Living Atlas: ${deepLink}`);
  lines.push(
    "",
    "Reply any time and a BeVvip specialist will take it from here — pricing,",
    "suites, dates, and availability.",
    "",
    "— BeVvip",
  );
  return lines.join("\n");
}

function htmlBody(names: string[], deepLink: string): string {
  const items = names.length
    ? names.map((n) => `<li style="margin:0 0 8px">${esc(n)}</li>`).join("")
    : `<li style="margin:0 0 8px">We&rsquo;ll follow up with the details we discussed.</li>`;
  const atlas = deepLink
    ? `<p style="margin:24px 0 0">
         <a href="${esc(deepLink)}" style="display:inline-block;padding:11px 20px;background:#0b0d12;color:#fff;text-decoration:none;border-radius:8px;font-size:15px">
           See them on the Living Atlas
         </a>
       </p>`
    : "";
  return `<!doctype html>
<html>
  <body style="margin:0;background:#f5f4f1;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1c20">
    <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;padding:32px 28px">
      <h1 style="margin:0 0 6px;font-size:20px;font-weight:600">Your BeVvip shortlist</h1>
      <p style="margin:0 0 18px;font-size:15px;color:#555">Here is what we put together:</p>
      <ul style="margin:0;padding-left:20px;font-size:16px;line-height:1.5">${items}</ul>
      ${atlas}
      <p style="margin:28px 0 0;font-size:14px;color:#555;line-height:1.6">
        Reply any time and a BeVvip specialist will take it from here &mdash; pricing,
        suites, dates, and availability.
      </p>
      <p style="margin:18px 0 0;font-size:14px;color:#888">&mdash; BeVvip</p>
    </div>
  </body>
</html>`;
}

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

export async function POST(req: Request) {
  const cors = corsHeaders(req);
  const limited = isRateLimited(req, cors);
  if (limited) return limited;

  if (!process.env.RESEND_API_KEY) {
    return Response.json(
      { ok: false, error: "Email delivery is not configured yet." },
      { status: 500, headers: cors },
    );
  }

  let body: ShortlistBody;
  try {
    body = (await req.json()) as ShortlistBody;
  } catch {
    return Response.json(
      { ok: false, error: "Invalid JSON." },
      { status: 400, headers: cors },
    );
  }

  const email = clip(body.email, 200);
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return Response.json(
      { ok: false, error: "A valid email is required." },
      { status: 422, headers: cors },
    );
  }

  const names = (body.shortlist ?? [])
    .map((n) => clip(n, 160))
    .filter(Boolean)
    .slice(0, 12);
  const deepLink = clip(body.deepLink, 1000);

  const resend = new Resend(process.env.RESEND_API_KEY);
  try {
    const { error } = await resend.emails.send({
      from: FROM,
      to: email,
      bcc: BCC,
      replyTo: BCC,
      subject: "Your BeVvip shortlist",
      text: plainBody(names, deepLink),
      html: htmlBody(names, deepLink),
    });
    if (error) {
      return Response.json(
        { ok: false, error: `Could not send (${error.name ?? "error"}).` },
        { status: 502, headers: cors },
      );
    }
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : "Could not send." },
      { status: 502, headers: cors },
    );
  }

  return Response.json({ ok: true }, { headers: cors });
}
