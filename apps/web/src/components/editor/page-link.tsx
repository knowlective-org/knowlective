"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, type ComponentProps } from "react";

// Farther than this, or held longer, a touch is a scroll or a long press, not
// a tap.
const TAP_MAX_MOVE_PX = 10;
const TAP_MAX_MS = 500;

// A link to a page inside a custom block (child page list, table, board),
// opened with a single tap. On a touch screen the browser sends a simulated
// mousemove before the click, BlockNote's side menu (the ⋮⋮ handle) appears
// for the block in response, and a phone browser that sees the page change on
// that "hover" drops the click: the link only opened on the second tap. A tap
// is handled here on touchend instead; preventDefault() stops the simulated
// mouse events and the click, so the side menu never gets to react.
// A native listener, for the same reason as the board's drag and drop.
export function PageLink({ href, ...props }: Omit<ComponentProps<typeof Link>, "href"> & { href: string }) {
  const ref = useRef<HTMLAnchorElement>(null);
  const router = useRouter();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let start: { x: number; y: number; t: number } | null = null;
    const onStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      start = e.touches.length === 1 ? { x: touch.clientX, y: touch.clientY, t: e.timeStamp } : null;
    };
    const onEnd = (e: TouchEvent) => {
      const s = start;
      start = null;
      const touch = e.changedTouches[0];
      if (!s || e.touches.length > 0 || !touch) return;
      if (Math.hypot(touch.clientX - s.x, touch.clientY - s.y) > TAP_MAX_MOVE_PX) return;
      if (e.timeStamp - s.t > TAP_MAX_MS) return;
      e.preventDefault();
      router.push(href);
    };
    const onCancel = () => {
      start = null;
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onCancel);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onCancel);
    };
  }, [href, router]);

  return <Link ref={ref} href={href} {...props} />;
}
