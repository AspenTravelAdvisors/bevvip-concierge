"use client";

/**
 * The phone breakpoint, as a hook.
 *
 * 680px is not a number this file gets to choose: it is the width at which
 * `app/globals.css` turns the atlas chrome into its phone layout — the filter
 * rail becomes a fixed bottom bar, the map becomes a clamped band, and the
 * property dossier stops being a panel beside the map. Anything that has to
 * agree with that layout in JS reads it from here, so the breakpoint exists
 * once on each side of the stack rather than once per component.
 *
 * Starts false and syncs in an effect on purpose. The server has no viewport,
 * so any other initial value is a hydration mismatch — the first client paint
 * is the desktop shape for one frame, and the layout that depends on this must
 * be able to survive that (it does: the dossier simply mounts in its panel and
 * moves into the card on the same tick the media query resolves).
 */

import { useEffect, useState } from "react";

export const PHONE_BREAKPOINT = "(max-width: 680px)";

export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(PHONE_BREAKPOINT);
    const sync = () => setMobile(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return mobile;
}
