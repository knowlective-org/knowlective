import { initialOf } from "@/lib/avatar-check";
import { resolveAppUrl } from "@/lib/base-path";
import { cursorColorFor } from "@/lib/cursor-color";
import styles from "./avatar.module.css";

// A person's picture (lib/avatar.ts), or the first character of their name
// on their color (the cursor's) when they have none. Beside their name, so
// it's left out of what's read aloud.
export function Avatar({
  userId,
  name,
  url,
  size = 24,
  className,
}: {
  userId: string;
  name: string | null;
  url: string | null | undefined;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={className ? `${styles.avatar} ${className}` : styles.avatar}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.5), ["--avatar-color" as string]: cursorColorFor(userId) }}
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
