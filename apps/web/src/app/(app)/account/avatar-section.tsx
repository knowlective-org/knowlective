"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Avatar } from "@/components/avatar";
import { StatusRow } from "@/components/status-row";
import { AVATAR_SIZE } from "@/lib/avatar-check";
import styles from "@/styles/ui.module.css";
import { removeAvatar, saveAvatar } from "./avatar-actions";

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
// taken away (their initial is shown instead).
export function AvatarSection({ userId, name, url }: { userId: string; name: string | null; url: string | null }) {
  const t = useTranslations("account.avatar");
  const tc = useTranslations("common");
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);

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
      <Avatar userId={userId} name={name} url={url} size={64} />
      <div style={{ flex: 1 }}>
        <div className={styles.note}>{t("note")}</div>
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
