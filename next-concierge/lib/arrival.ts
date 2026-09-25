// lib/arrival.ts — which AI assistant, if any, sent this visitor.
//
// The site is deliberately open to AI answer engines (app/robots.js), on the
// bet that being cited by ChatGPT, Perplexity, Claude or Gemini turns into
// bookings. Nothing measured that bet: a visitor who clicked through from a
// ChatGPT answer looked exactly like one who typed the address. This file
// records the answer engine at the moment of arrival so the two conversion
// events that matter — booking_clicked and advisor_request_sent — and the
// advisor's hand-off email can say "came from ChatGPT".
//
// HOW IT KNOWS. Two signals, checked in order:
//
//   1. utm_source on the landing URL. ChatGPT appends utm_source=chatgpt.com to
//      the links in its answers, and Perplexity and Copilot do similarly on
//      some surfaces. It survives even when the browser strips the referrer.
//   2. document.referrer's host. Most assistants open links with a referrer
//      policy that still sends the origin.
//
// An assistant that sends neither is invisible here, so these numbers are a
// floor, not a census.
//
// FIRST TOUCH, KEPT FOR 30 DAYS. A traveler who reads a Perplexity answer today
// and comes back by typing the address next week is still Perplexity's lead —
// luxury trips are researched over weeks, not in one sitting. A later arrival
// from a DIFFERENT assistant does not overwrite the first. Stored in
// localStorage, which can be missing or throw (private windows, blocked site
// data); every access is guarded and a failure just means "unknown".

const KEY = "ebl.arrival";
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Host suffix → the name we report. Order matters only for readability. */
const AI_SOURCES: ReadonlyArray<[string, string]> = [
  ["chatgpt.com", "chatgpt"],
  ["chat.openai.com", "chatgpt"],
  ["perplexity.ai", "perplexity"],
  ["claude.ai", "claude"],
  ["gemini.google.com", "gemini"],
  ["bard.google.com", "gemini"],
  ["copilot.microsoft.com", "copilot"],
  ["meta.ai", "meta-ai"],
  ["grok.com", "grok"],
  ["x.ai", "grok"],
  ["chat.deepseek.com", "deepseek"],
  ["you.com", "you"],
  ["phind.com", "phind"],
  ["poe.com", "poe"],
  ["kagi.com", "kagi"],
  ["chat.mistral.ai", "mistral"],
];

/** Human label for the advisor email. */
const LABEL: Record<string, string> = {
  chatgpt: "ChatGPT",
  perplexity: "Perplexity",
  claude: "Claude",
  gemini: "Gemini",
  copilot: "Microsoft Copilot",
  "meta-ai": "Meta AI",
  grok: "Grok",
  deepseek: "DeepSeek",
  you: "You.com",
  phind: "Phind",
  poe: "Poe",
  kagi: "Kagi",
  mistral: "Mistral Le Chat",
};

export interface Arrival {
  /** Short id, e.g. "chatgpt". */
  source: string;
  /** Which signal identified it. */
  via: "utm" | "referrer";
  /** First page they landed on, path only. */
  landing: string;
  at: number;
}

/** Match a host or a bare utm_source value ("chatgpt.com", "perplexity") to an assistant. */
export function classifyAiSource(value: string | null | undefined): string | null {
  const v = String(value || "").trim().toLowerCase();
  if (!v) return null;
  let host = v;
  try {
    if (v.includes("://")) host = new URL(v).hostname;
  } catch {
    /* not a URL — treat as a bare host or utm value */
  }
  host = host.replace(/^www\./, "");
  for (const [suffix, name] of AI_SOURCES) {
    if (host === suffix || host.endsWith(`.${suffix}`)) return name;
  }
  // utm_source is sometimes the bare name rather than a host.
  if (Object.prototype.hasOwnProperty.call(LABEL, host)) return host;
  return null;
}

export function arrivalLabel(source: string | null | undefined): string {
  const s = String(source || "");
  return LABEL[s] || s;
}

// Fallback for when storage throws: the arrival still holds for this page's
// lifetime, which covers a single-visit booking.
let memo: Arrival | null = null;

function read(): Arrival | null {
  if (memo) return memo;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const a = JSON.parse(raw) as Arrival;
    if (!a || typeof a.source !== "string" || !(Date.now() - a.at < TTL_MS)) return null;
    return a;
  } catch {
    return null;
  }
}

/**
 * Record this page load's AI source, if it has one and none is on file.
 * Returns the arrival only when it was newly recorded, so the caller can emit
 * a one-off analytics event without double-counting reloads.
 */
export function captureArrival(): Arrival | null {
  if (typeof window === "undefined") return null;
  if (read()) return null;

  let source: string | null = null;
  let via: Arrival["via"] = "utm";
  try {
    source = classifyAiSource(new URLSearchParams(window.location.search).get("utm_source"));
  } catch {
    /* malformed query — fall through to the referrer */
  }
  if (!source) {
    via = "referrer";
    source = classifyAiSource(document.referrer);
  }
  if (!source) return null;

  const arrival: Arrival = { source, via, landing: window.location.pathname, at: Date.now() };
  memo = arrival;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(arrival));
  } catch {
    /* storage unavailable — this page view still counts via the return value */
  }
  return arrival;
}

/** The AI assistant that first sent this visitor, or null. Safe on the server. */
export function arrivalSource(): string | null {
  if (typeof window === "undefined") return null;
  return read()?.source ?? null;
}
