"use client";

import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import type * as Y from "yjs";
import { getUploadPolicy } from "@/app/(app)/actions";
import { showAlert } from "@/components/dialog";
import { beginSaving } from "@/lib/saving-status";
import { UploadError, postFile } from "@/lib/upload-file";
import { isUploadAllowed } from "@/lib/upload-types";
import { ITEM_COLORS, SLIDE_FIELD, type SlideBackground } from "@/lib/whiteboard";
import styles from "./presentation.module.css";

const COLORS = ITEM_COLORS.filter((c) => c !== "transparent");
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

// The open slide's background: a color or an image (an attachment of the
// presentation), in the slide's document.
export function SlideBackgroundBar({ doc, deckId, background }: { doc: Y.Doc; deckId: string; background: SlideBackground }) {
  const t = useTranslations("presentation");
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const set = (color: string | null, image: string | null) =>
    doc.transact(() => {
      const slide = doc.getMap<unknown>(SLIDE_FIELD);
      if (color) slide.set("background", color);
      else slide.delete("background");
      if (image) slide.set("backgroundImage", image);
      else slide.delete("backgroundImage");
    });

  const upload = async (file: File) => {
    if (!IMAGE_TYPES.includes(file.type)) {
      await showAlert(t("backgroundImageOnly"));
      return;
    }
    const policy = await getUploadPolicy().catch(() => ({ enabled: true, extensions: [] as string[] }));
    if (!policy.enabled || !isUploadAllowed(file.name, policy.extensions)) {
      await showAlert(t("backgroundRefused"));
      return;
    }
    setBusy(true);
    const done = beginSaving();
    try {
      set(null, await postFile(deckId, file, t("backgroundFailed")));
    } catch (error) {
      await showAlert(error instanceof UploadError ? error.message : t("backgroundFailed"));
    } finally {
      done();
      setBusy(false);
    }
  };

  return (
    <div className={styles.backgroundBar} role="group" aria-label={t("background")} data-ui="SlideBackgroundBar">
      <span>{t("background")}</span>
      {COLORS.map((color) => (
        <button
          key={color}
          type="button"
          className={styles.backgroundSwatch}
          style={{ background: `var(--color-wb-${color})` }}
          aria-label={color}
          aria-pressed={background.color === color}
          onClick={() => set(color, null)}
          data-ui="SlideBackgroundBar.colorButton"
          data-id={color}
        />
      ))}
      <button type="button" disabled={busy} onClick={() => input.current?.click()} data-ui="SlideBackgroundBar.imageButton">
        {t("backgroundImage")}
      </button>
      <button
        type="button"
        disabled={!background.color && !background.image}
        onClick={() => set(null, null)}
        data-ui="SlideBackgroundBar.clearButton"
      >
        {t("backgroundClear")}
      </button>
      <input
        ref={input}
        type="file"
        accept={IMAGE_TYPES.join(",")}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void upload(file);
        }}
        data-ui="SlideBackgroundBar.imageInput"
      />
    </div>
  );
}
