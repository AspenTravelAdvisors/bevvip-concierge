"use client";

/**
 * The one control that puts something on the bucket list.
 *
 * There is exactly one of these for the same reason there is exactly one
 * advisor CTA (see AdvisorRequest): a save has to mean the same thing and look
 * the same way on a result card, a villa card, a Guide answer and the property
 * dossier, or the list reads as four features that happen to share storage.
 * Map pins are the exception the delegation in AtlasShell exists for — a popup
 * is injected HTML with no React tree to mount into — and they carry the same
 * label and the same glyphs.
 *
 * The glyph is a heart, not a star. Hotels on this atlas already carry star
 * ratings (Forbes, AAA Diamond) and a star beside one would read as a score
 * rather than a choice.
 */

import { bucketListRemoved, bucketListSaved, type BucketSource } from "@/lib/analytics";
import {
  bucketKey,
  bucketListCount,
  isSaved,
  toggleItem,
  useIsSaved,
  type SavedItemInput,
} from "@/lib/bucket-list";

/** Said the same way everywhere, in both states. */
export const BUCKET_ADD = "Bucket list";
export const BUCKET_SAVED = "On your list";

interface Props {
  item: SavedItemInput;
  source: BucketSource;
  /**
   * How loudly it renders.
   *
   *   "button"  outlined, matched to the card's other boxed actions
   *   "quiet"   a plain text control, for cards whose actions are text links
   *   "icon"    the glyph alone, for a photograph's corner or a dense card
   */
  variant?: "button" | "quiet" | "icon";
  className?: string;
}

export default function BucketListButton({ item, source, variant = "button", className }: Props) {
  const saved = useIsSaved(bucketKey(item.type, item.id));
  const label = saved ? BUCKET_SAVED : BUCKET_ADD;
  return (
    <button
      type="button"
      className={`bl-btn bl-btn--${variant}${className ? ` ${className}` : ""}`}
      data-saved={saved ? "" : undefined}
      aria-pressed={saved}
      // The icon variant has no text, and "On your list" alone does not say
      // what pressing it does. Both states name the list.
      aria-label={saved ? `${item.title} — on your bucket list. Remove it.` : `Add ${item.title} to your bucket list`}
      title={saved ? "On your bucket list — press to remove" : "Add to your bucket list"}
      onClick={(e) => {
        // Every surface this sits on has its own click behaviour — a card that
        // selects, a link that navigates. Saving is never also that.
        e.stopPropagation();
        e.preventDefault();
        const nowSaved = toggleItem(item);
        const size = bucketListCount();
        if (nowSaved) bucketListSaved(item.type, source, size);
        else bucketListRemoved(item.type, source, size);
      }}
    >
      <span className="bl-glyph" aria-hidden="true">{saved ? "♥" : "♡"}</span>
      {variant !== "icon" && <span className="bl-label">{label}</span>}
    </button>
  );
}

// ── The same control, as injected HTML ──────────────────────────────────────
//
// A map popup is an HTML string handed to Mapbox, with no React tree to mount
// into — which is why "Ask The Guide" and "Property details & 3D" are already
// `data-*` attributes with one delegated listener behind them (see AtlasShell).
// The save has to work the same way, and it lives HERE rather than beside that
// delegation so the two renderings can never drift apart on wording, glyph or
// analytics. If the label changes, it changes for both.

/** Escapes for an HTML attribute or text node. Supplied by the caller. */
type Escape = (s: string) => string;

/**
 * A save button for a popup, in whichever state the offering is currently in.
 *
 * The payload rides on the element as JSON because the popup outlives the code
 * that built it: by the time someone clicks, the handler has only the DOM.
 */
export function bucketButtonHtml(item: SavedItemInput, esc: Escape): string {
  const saved = isSaved(bucketKey(item.type, item.id));
  const payload = esc(JSON.stringify(item));
  return (
    `<button type="button" class="iwbucket" data-bucket="${payload}"` +
    ` aria-pressed="${saved}"${saved ? " data-saved" : ""}` +
    ` title="${saved ? "On your bucket list — press to remove" : "Add to your bucket list"}">` +
    `<span class="bl-glyph" aria-hidden="true">${saved ? "♥" : "♡"}</span>` +
    `<span class="bl-label">${saved ? BUCKET_SAVED : BUCKET_ADD}</span></button>`
  );
}

/**
 * Handle a click anywhere in the document that landed on a popup save button.
 *
 * Repaints the button in place rather than re-rendering the popup: Mapbox owns
 * that HTML, and re-setting it would tear down and rebuild the whole bubble —
 * losing the rate link that gets patched in a beat after the popup opens.
 *
 * Returns whether the click was one of ours, so the caller can leave everything
 * else alone.
 */
export function handleBucketPopupClick(e: Event, source: BucketSource = "pin"): boolean {
  const el = (e.target as HTMLElement | null)?.closest?.("[data-bucket]") as HTMLElement | null;
  const raw = el?.getAttribute("data-bucket");
  if (!el || !raw) return false;
  e.preventDefault();
  let item: SavedItemInput;
  try {
    item = JSON.parse(raw) as SavedItemInput;
  } catch {
    return false; // malformed payload: do nothing rather than save a blank
  }
  if (!item?.type || !item?.id) return false;
  const saved = toggleItem(item);
  const size = bucketListCount();
  if (saved) bucketListSaved(item.type, source, size);
  else bucketListRemoved(item.type, source, size);
  el.setAttribute("aria-pressed", String(saved));
  if (saved) el.setAttribute("data-saved", "");
  else el.removeAttribute("data-saved");
  el.setAttribute(
    "title",
    saved ? "On your bucket list — press to remove" : "Add to your bucket list",
  );
  const glyph = el.querySelector(".bl-glyph");
  if (glyph) glyph.textContent = saved ? "♥" : "♡";
  const label = el.querySelector(".bl-label");
  if (label) label.textContent = saved ? BUCKET_SAVED : BUCKET_ADD;
  return true;
}
