import { type AvatarLook, initialOf } from "@/lib/avatar-check";
import { mosaicBackground, mosaicOutline } from "@/lib/avatar-mosaic";
import { resolveAppUrl } from "@/lib/base-path";
import { cursorColorFor } from "@/lib/cursor-color";
import styles from "./avatar.module.css";

// A person's picture (lib/avatar.ts), or without one, a mosaic in shades of
// their color (their cursor's unless they chose one) with the first
// character of their name on it (lib/avatar-mosaic.ts). `look` missing: the
// mosaic in their cursor's color. Beside their name, so it's left out of
// what's read aloud.
export function Avatar({
  userId,
  name,
  look,
  size = 24,
  className,
}: {
  userId: string;
  name: string | null;
  look: AvatarLook | null | undefined;
  size?: number;
  className?: string;
}) {
  const url = look?.url ?? null;
  const color = look?.color ?? cursorColorFor(userId);
  return (
    <span
      className={className ? `${styles.avatar} ${className}` : styles.avatar}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.6),
        ...(!url && {
          backgroundImage: mosaicBackground(userId, look?.seed ?? 0, color),
          ["--avatar-outline" as string]: mosaicOutline(color),
        }),
      }}
      aria-hidden
      data-ui="Avatar"
      data-id={userId}
      data-image={url ? "" : undefined}
      // Drawn by CSS: not part of the text around it (what's read, found or copied).
      data-initial={url ? undefined : initialOf(name)}
    >
      {url && (
        // eslint-disable-next-line @next/next/no-img-element -- served with an access check
        <img src={resolveAppUrl(url)} alt="" width={size} height={size} draggable={false} />
      )}
    </span>
  );
}
