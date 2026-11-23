"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import type { NumberPosition } from "@/lib/presentation";
import type { DeckSlide } from "@/lib/presentation-data";
import { slideMarkup } from "./slide-render";
import styles from "./presentation.module.css";

// The slide over the whole screen. The presenter goes through the shown
// slides (arrow keys, space, a click); someone following sees the presenter's
// slide and can only leave.
export function PresentationScreen({
  slides,
  states,
  slideId,
  position,
  following,
  ended,
  presenterName,
  onGo,
  onExit,
}: {
  // The shown slides, in order.
  slides: DeckSlide[];
  // The slides' contents (base64 Yjs states).
  states: Record<string, string>;
  slideId: string | null;
  position: NumberPosition;
  following: boolean;
  // Following, and the presenter has stopped.
  ended: boolean;
  presenterName: string | null;
  onGo: (slideId: string) => void;
  onExit: () => void;
}) {
  const t = useTranslations("presentation");
  const rootRef = useRef<HTMLDivElement>(null);
  const index = slides.findIndex((s) => s.id === slideId);
  const slide = index >= 0 ? slides[index] : null;
  // Drawn ahead for the slides next to this one, so going on doesn't wait.
  const [drawn, setDrawn] = useState<Record<string, { state: string; markup: string; onImage: boolean }>>({});
  const drawing = useRef(new Map<string, string>());
  const nearby = [index - 1, index, index + 1, index + 2].flatMap((i) => (slides[i] ? [slides[i].id] : []));
  const nearbyKey = nearby.map((id) => `${id}:${states[id]?.length ?? 0}:${states[id]?.slice(-16) ?? ""}`).join(" ");
  useEffect(() => {
    for (const id of nearbyKey ? nearbyKey.split(" ").map((k) => k.split(":")[0]) : []) {
      const state = states[id];
      if (!state || drawing.current.get(id) === state) continue;
      drawing.current.set(id, state);
      void slideMarkup(state)
        .then(({ svg, onImage }) => setDrawn((prev) => ({ ...prev, [id]: { state, markup: svg, onImage } })))
        .catch(() => drawing.current.delete(id));
    }
    // `nearbyKey` stands for the states of these slides.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nearbyKey]);
  const picture = slide ? drawn[slide.id]?.markup : undefined;

  const go = (delta: number) => {
    if (following || index < 0) return;
    const next = slides[index + delta];
    if (next) onGo(next.id);
  };
  const goRef = useRef(go);
  const exitRef = useRef(onExit);
  useEffect(() => {
    goRef.current = go;
    exitRef.current = onExit;
  });

  // The real full screen if the browser gives it; the window otherwise.
  useEffect(() => {
    const el = rootRef.current;
    let entered = false;
    const onChange = () => {
      if (document.fullscreenElement === el) entered = true;
      else if (entered) exitRef.current();
    };
    document.addEventListener("fullscreenchange", onChange);
    void el?.requestFullscreen?.().catch(() => {});
    el?.focus();
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      if (document.fullscreenElement === el) void document.exitFullscreen().catch(() => {});
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const forward = e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === "PageDown" || e.key === " " || e.key === "Enter";
      const back = e.key === "ArrowLeft" || e.key === "ArrowUp" || e.key === "PageUp" || e.key === "Backspace";
      if (e.key === "Escape") exitRef.current();
      else if (forward) goRef.current(1);
      else if (back) goRef.current(-1);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  return (
    <div
      ref={rootRef}
      className={styles.screen}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={t("screenLabel")}
      data-ui="PresentationScreen"
      data-following={following ? "" : undefined}
      data-id={slide?.id}
      onClick={() => go(1)}
    >
      <div className={styles.screenSlide}>
        {slide && picture ? (
          <div
            className={styles.screenPicture}
            role="img"
            aria-label={t("slideAlt", { n: index + 1 })}
            data-ui="PresentationScreen.slideImage"
            // Made by whiteboardSvg(), which escapes everything from the document.
            dangerouslySetInnerHTML={{ __html: picture }}
          />
        ) : (
          <p className={styles.screenMessage} role="status" data-ui="PresentationScreen.status">
            {ended ? t("presentationEnded") : slide ? t("loading") : t("noShownSlides")}
          </p>
        )}
        {slide && slide.number !== null && picture && (
          <div className={styles.screenNumberArea} data-position={position} data-on-image={slide && drawn[slide.id]?.onImage ? "" : undefined}>
            <span className={styles.screenNumber} data-ui="PresentationScreen.slideNumber">
              {slide.number}
            </span>
          </div>
        )}
      </div>
      <div className={styles.screenBar} onClick={(e) => e.stopPropagation()}>
        {following && presenterName && !ended && <span data-ui="PresentationScreen.presenterStatus">{t("presenting", { name: presenterName })}</span>}
        {ended && slide && <span role="status" data-ui="PresentationScreen.endedStatus">{t("presentationEnded")}</span>}
        {!following && (
          <>
            <button type="button" disabled={index <= 0} onClick={() => go(-1)} data-ui="PresentationScreen.previousButton">
              {t("previous")}
            </button>
            <span role="status" data-ui="PresentationScreen.position">
              {index + 1} / {slides.length}
            </span>
            <button type="button" disabled={index < 0 || index >= slides.length - 1} onClick={() => go(1)} data-ui="PresentationScreen.nextButton">
              {t("next")}
            </button>
          </>
        )}
        <button type="button" onClick={onExit} data-ui="PresentationScreen.exitButton">
          {t("exitScreen")}
        </button>
      </div>
    </div>
  );
}
