"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Avatar } from "@/components/avatar";
import { StatusRow } from "@/components/status-row";
import { AVATAR_SIZE, type AvatarLook } from "@/lib/avatar-check";
import { AVATAR_COLOR_PRESETS } from "@/lib/avatar-mosaic";
import { cursorColorFor } from "@/lib/cursor-color";
import styles from "@/styles/ui.module.css";
import avatarStyles from "./avatar-section.module.css";
import { newAvatarPattern, removeAvatar, saveAvatar, saveAvatarColor } from "./avatar-actions";

// Made in the browser: the middle square of the chosen picture, at
// AVATAR_SIZE (WebP where the browser can write it, else PNG). Null: not a
// picture the browser can read.
async function squareOf(file: File): Promise<Blob | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const context = canvas.getContext("2d");
  if (!context || side === 0) return null;
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  bitmap.close();
  const blob = (type: string) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.88));
  const webp = await blob("image/webp");
  return webp?.type === "image/webp" ? webp : await blob("image/png");
}

// The user's own picture on the account screen: chosen from a file, or
// taken away. Without one, a mosaic with their initial: its color (any, or
// a suggested one) and another pattern can be chosen here.
export function AvatarSection({ userId, name, look }: { userId: string; name: string | null; look: AvatarLook }) {
  const url = look.url;
  const t = useTranslations("account.avatar");
  const tc = useTranslations("common");
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  // The color being picked, shown before it's saved.
  const [picking, setPicking] = useState<string | null>(null);
  const color = picking ?? look.color ?? cursorColorFor(userId);

  const run = (action: () => Promise<{ error?: string }>) =>
    startTransition(async () => {
      setMessage(null);
      const result = await action().catch(() => ({ error: t("notSaved") }));
      setMessage(result.error ? { error: true, text: result.error } : { error: false, text: tc("saved") });
      setPicking(null);
      router.refresh();
    });

  const choose = (file: File) =>
    startTransition(async () => {
      setMessage(null);
      const square = await squareOf(file);
      if (!square) {
        setMessage({ error: true, text: t("badType") });
        return;
      }
      const data = new FormData();
      data.set("avatar", new File([square], `avatar.${square.type === "image/webp" ? "webp" : "png"}`, { type: square.type }));
      const result = await saveAvatar(data).catch(() => ({ error: t("failed") }));
      setMessage(result.error ? { error: true, text: result.error } : { error: false, text: tc("saved") });
      router.refresh();
    });

  const remove = () =>
    startTransition(async () => {
      setMessage(null);
      const result = await removeAvatar().catch(() => ({ error: t("failed") }));
      setMessage(result.error ? { error: true, text: result.error } : { error: false, text: tc("saved") });
      router.refresh();
    });

  return (
    <div data-ui="AvatarSection" style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 20 }}>
      <Avatar userId={userId} name={name} look={{ ...look, color }} size={64} />
      <div style={{ flex: 1 }}>
        <div className={styles.note}>{t("note")}</div>
        {!url && (
          <div className={avatarStyles.mosaic} role="group" aria-label={t("mosaicColor")}>
            <span className={avatarStyles.label}>{t("mosaicColor")}</span>
            {AVATAR_COLOR_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                className={avatarStyles.swatch}
                style={{ background: preset }}
                aria-label={preset}
                title={preset}
                aria-pressed={color === preset}
                disabled={pending}
                onClick={() => run(() => saveAvatarColor(preset))}
                data-ui="AvatarSection.colorPresetButton"
                data-id={preset}
              />
            ))}
            <input
              type="color"
              className={avatarStyles.picker}
              value={color}
              aria-label={t("otherColor")}
              title={t("otherColor")}
              disabled={pending}
              // Shown while picking; saved when the picker is closed.
              onInput={(e) => setPicking(e.currentTarget.value)}
              onChange={(e) => run(() => saveAvatarColor(e.target.value))}
              data-ui="AvatarSection.colorInput"
            />
            <button type="button" className={styles.buttonSecondary} disabled={pending} onClick={() => run(newAvatarPattern)} data-ui="AvatarSection.patternButton">
              {t("anotherPattern")}
            </button>
            {look.color && (
              <button type="button" className={styles.buttonSecondary} disabled={pending} onClick={() => run(() => saveAvatarColor(null))} data-ui="AvatarSection.resetColorButton">
                {t("resetColor")}
              </button>
            )}
          </div>
        )}
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) choose(file);
          }}
          data-ui="AvatarSection.fileInput"
        />
        <StatusRow message={message?.text ?? ""} className={message?.error ? styles.error : styles.success} dataUi="AvatarSection.status">
          {url && (
            <button type="button" className={styles.buttonSecondary} disabled={pending} onClick={remove} data-ui="AvatarSection.removeButton">
              {t("remove")}
            </button>
          )}
          <button type="button" className={styles.button} disabled={pending} onClick={() => input.current?.click()} data-ui="AvatarSection.chooseButton">
            {pending ? tc("saving") : t("choose")}
          </button>
        </StatusRow>
      </div>
    </div>
  );
}
