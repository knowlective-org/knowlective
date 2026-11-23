"use client";

import type { HocuspocusProvider } from "@hocuspocus/provider";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { movePage } from "@/app/(app)/page-move-actions";
import { deletePage } from "@/app/(app)/pages/[pageId]/page-actions";
import { addSlide, loadPresentation, loadSlideStates, saveNumbering, setSlideFlag } from "@/app/(app)/pages/[pageId]/presentation-actions";
import { CollabConnection } from "@/components/collab-connection";
import { showAlert, showChoice, showConfirm } from "@/components/dialog";
import { EditorPlaceholder } from "@/components/editor-placeholder";
import { Icon } from "@/components/icons";
import { showNotice } from "@/components/notice";
import { setDraggedPage } from "@/components/move-page";
import { TitleField } from "@/components/title-field";
import { WhiteboardCanvas } from "@/components/whiteboard/whiteboard-canvas";
import { useDisplayTitle } from "@/i18n/use-display-title";
import { CHILDREN_CHANGED } from "@/lib/collab-events";
import { EXPORT_PDF_EVENT } from "@/lib/page-export";
import { readCursorUser } from "@/lib/avatar-mosaic";
import {
  MAX_NUMBER_START,
  MAX_SLIDES,
  MIN_NUMBER_START,
  NUMBER_POSITIONS,
  type NumberPosition,
  isNumberStart,
  nearestShownSlide,
  shownSlides,
} from "@/lib/presentation";
import { currentStage, isSlideId } from "@/lib/presentation-stage";
import type { DeckSlide, DeckView } from "@/lib/presentation-data";
import { TITLE_FIELD } from "@/lib/page-title";
import { SLIDE_FIELD, readSlideBackground } from "@/lib/whiteboard";
import { beginSaving } from "@/lib/saving-status";
import { PresentationScreen } from "./presentation-screen";
import { SlideBackgroundBar } from "./slide-background-bar";
import { SlideNotes } from "./slide-notes";
import { slideThumbnail } from "./slide-render";
import styles from "./presentation.module.css";

const STATES_PER_REQUEST = 24;

type Props = {
  pageId: string;
  readOnly: boolean;
  onTitleChange?: (title: string) => void;
};

// A presentation page: its title (in its own document), the list of slides
// and the slide being edited. Only the open slide has a collaboration
// connection: the others are pictures from the server's snapshots, redrawn
// when the server says a slide changed.
export function PresentationEditor(props: Props) {
  return <CollabConnection pageId={props.pageId}>{(provider) => <Deck {...props} provider={provider} />}</CollabConnection>;
}

// The slide list's pictures, loaded for the slides that are new or changed.
function useThumbnails(deckId: string, slides: DeckSlide[] | null) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [states, setStates] = useState<Record<string, string>>({});
  const loaded = useRef(new Map<string, string>());
  useEffect(() => {
    if (!slides) return;
    const seen = loaded.current;
    const stale = slides.filter((s) => seen.get(s.id) !== s.updatedAt);
    if (stale.length === 0) return;
    for (const s of stale) seen.set(s.id, s.updatedAt);
    let cancelled = false;
    void (async () => {
      for (let i = 0; i < stale.length && !cancelled; i += STATES_PER_REQUEST) {
        const loadedStates = await loadSlideStates(deckId, stale.slice(i, i + STATES_PER_REQUEST).map((s) => s.id)).catch(() => []);
        if (!cancelled) setStates((prev) => ({ ...prev, ...Object.fromEntries(loadedStates.map((s) => [s.id, s.state])) }));
        const drawn = await Promise.all(
          loadedStates.map(async ({ id, state }) => [id, await slideThumbnail(state).catch(() => "")] as const),
        );
        if (!cancelled) setUrls((prev) => ({ ...prev, ...Object.fromEntries(drawn.filter(([, url]) => url)) }));
      }
    })();
    return () => {
      cancelled = true;
      // Tried again by the next run.
      for (const s of stale) seen.delete(s.id);
    };
  }, [deckId, slides]);
  return { urls, states };
}

type AwarenessView = {
  stage: { key: string; own: boolean; slideId: string; name: string | null } | null;
  // Who else is on each slide.
  viewers: Record<string, { id: number; name: string; color: string }[]>;
};
const NO_ONE: AwarenessView = { stage: null, viewers: {} };

// The presentation's awareness: who's presenting, and who's on which slide.
function useDeckAwareness(provider: HocuspocusProvider): AwarenessView {
  const view = useRef<{ json: string; value: AwarenessView }>({ json: "", value: NO_ONE });
  const read = useCallback(() => {
    const awareness = provider.awareness;
    if (!awareness) return NO_ONE;
    const states = [...awareness.getStates()] as [number, Record<string, unknown>][];
    const stage = currentStage(states);
    const viewers: AwarenessView["viewers"] = {};
    for (const [id, state] of states) {
      if (id === awareness.clientID || !isSlideId(state.viewing)) continue;
      const user = readCursorUser(state.user);
      if (user) (viewers[state.viewing] ??= []).push({ id, name: user.name, color: user.color });
    }
    const value: AwarenessView = {
      stage: stage && {
        key: `${stage.clientId}:${stage.presenting.since}`,
        own: stage.clientId === awareness.clientID,
        slideId: stage.presenting.slideId,
        name: readCursorUser(stage.state.user)?.name ?? null,
      },
      viewers,
    };
    // The same object while nothing changed (useSyncExternalStore).
    const json = JSON.stringify(value);
    if (json !== view.current.json) view.current = { json, value };
    return view.current.value;
  }, [provider]);
  const subscribe = useCallback(
    (onChange: () => void) => {
      provider.awareness?.on("change", onChange);
      return () => provider.awareness?.off("change", onChange);
    },
    [provider],
  );
  return useSyncExternalStore(subscribe, read, () => NO_ONE);
}

function Deck({ pageId, readOnly, onTitleChange, provider }: Props & { provider: HocuspocusProvider }) {
  const t = useTranslations("presentation");
  const [deck, setDeck] = useState<DeckView | null>(null);
  const [requested, setRequested] = useState<string | null>(() => new URLSearchParams(window.location.search).get("slide"));
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropBefore, setDropBefore] = useState<string | null | undefined>(undefined);

  const refresh = useCallback(async () => {
    const next = await loadPresentation(pageId).catch(() => null);
    if (next) setDeck(next);
  }, [pageId]);
  useEffect(() => {
    let cancelled = false;
    void loadPresentation(pageId)
      .catch(() => null)
      .then((next) => {
        if (next && !cancelled) setDeck(next);
      });
    return () => {
      cancelled = true;
    };
  }, [pageId]);

  // Slides added, moved or changed by anyone.
  useEffect(() => {
    const onStateless = ({ payload }: { payload: string }) => {
      try {
        if ((JSON.parse(payload) as { type?: string }).type === CHILDREN_CHANGED) void refresh();
      } catch {
        // Not ours.
      }
    };
    provider.on("stateless", onStateless);
    return () => {
      provider.off("stateless", onStateless);
    };
  }, [provider, refresh]);

  // The page menu's PDF. The export code is loaded only then.
  const locale = useLocale();
  const displayTitle = useDisplayTitle();
  useEffect(() => {
    const onExport = () => {
      showNotice(t("exporting"));
      void import("./slide-pdf-export").then(async ({ NoSlidesToExport, exportPresentationPdf }) => {
        try {
          await exportPresentationPdf(pageId, displayTitle(provider.document.getText(TITLE_FIELD).toString()), locale);
        } catch (err) {
          console.error("Presentation PDF export failed", err);
          await showAlert(err instanceof NoSlidesToExport ? t("noShownSlides") : t("exportFailed"));
        }
      });
    };
    window.addEventListener(EXPORT_PDF_EVENT, onExport);
    return () => window.removeEventListener(EXPORT_PDF_EVENT, onExport);
  }, [pageId, provider, displayTitle, locale, t]);

  // The saving mark at the top of the page, for the title.
  useEffect(() => {
    let finish: (() => void) | null = null;
    const update = () => {
      if (provider.hasUnsyncedChanges) finish ??= beginSaving();
      else {
        finish?.();
        finish = null;
      }
    };
    update();
    provider.on("unsyncedChanges", update);
    return () => {
      provider.off("unsyncedChanges", update);
      finish?.();
    };
  }, [provider]);

  const slides = deck?.slides ?? null;
  const { urls: thumbnails, states: slideStates } = useThumbnails(pageId, slides);
  const current = slides?.find((s) => s.id === requested) ?? slides?.[0] ?? null;
  const { stage, viewers } = useDeckAwareness(provider);
  // On the presentation screen: alone, with everyone asked to switch, or
  // following someone else.
  const [screen, setScreen] = useState<"solo" | "broadcast" | "follow" | null>(null);
  const [presented, setPresented] = useState<string | null>(null);
  // The presenter's request this person said no to.
  const [declined, setDeclined] = useState<string | null>(null);
  const order = slides?.map((s) => s.id) ?? [];
  const orderKey = order.join(" ");
  // The presenter's slide, moved on if it was hidden or deleted meanwhile.
  const ownSlide = deck && presented ? nearestShownSlide(order, deck.settings, presented) : null;

  useEffect(() => {
    provider.awareness?.setLocalStateField("user", {});
  }, [provider]);
  const viewing = current?.id ?? null;
  useEffect(() => {
    provider.awareness?.setLocalStateField("viewing", viewing);
  }, [provider, viewing]);
  // What everyone following sees.
  const broadcastSlide = screen === "broadcast" ? ownSlide : null;
  useEffect(() => {
    provider.awareness?.setLocalStateField("presenting", broadcastSlide ? { slideId: broadcastSlide } : null);
  }, [provider, broadcastSlide, orderKey]);

  // The open slide is in the address, so that a link opens it.
  const currentId = current?.id ?? null;
  useEffect(() => {
    if (!currentId) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("slide") === currentId) return;
    url.searchParams.set("slide", currentId);
    window.history.replaceState(null, "", url);
  }, [currentId]);

  if (!deck || !slides) return <EditorPlaceholder />;
  const canChangeDeck = !readOnly && deck.canEdit;
  const shownIds = new Set(shownSlides(slides.map((s) => s.id), deck.settings));
  const shown = slides.filter((s) => shownIds.has(s.id));
  const someoneElse = stage && !stage.own ? stage : null;

  const startPresenting = async () => {
    const first = current && shownIds.has(current.id) ? current.id : (shown[0]?.id ?? null);
    if (!first) return;
    const choice = await showChoice(
      someoneElse ? t("presentBusy", { name: someoneElse.name ?? "" }) : t("presentChoice"),
      [
        { value: "solo" as const, label: t("presentSolo") },
        ...(someoneElse ? [] : [{ value: "broadcast" as const, label: t("presentEveryone") }]),
      ],
      { title: t("present") },
    );
    if (!choice) return;
    setPresented(first);
    setScreen(choice);
  };

  const report = async (result: { error?: string } | undefined) => {
    if (result?.error) await showAlert(result.error);
    await refresh();
  };

  const add = async () => {
    const result = await addSlide(pageId, current?.id ?? null);
    if ("error" in result) {
      await showAlert(result.error);
      return;
    }
    setRequested(result.id);
    await refresh();
  };

  const remove = async (slide: DeckSlide, index: number) => {
    if (!(await showConfirm(t("deleteConfirm", { n: index + 1 }), { danger: true }))) return;
    const result = await deletePage(slide.id);
    if ("error" in result) {
      await showAlert(result.error);
      return;
    }
    if (slide.id === current?.id) setRequested(slides[index + 1]?.id ?? slides[index - 1]?.id ?? null);
    await refresh();
  };

  const drop = async (beforeId: string | null) => {
    const id = dragging;
    setDragging(null);
    setDropBefore(undefined);
    if (!id || beforeId === id) return;
    const order = slides.map((s) => s.id);
    if ((order[order.indexOf(id) + 1] ?? null) === beforeId) return;
    // Shown at once; the server's order follows.
    const moved = slides.find((s) => s.id === id)!;
    const rest = slides.filter((s) => s.id !== id);
    const at = beforeId === null ? rest.length : rest.findIndex((s) => s.id === beforeId);
    setDeck({ ...deck, slides: [...rest.slice(0, at), moved, ...rest.slice(at)] });
    await report(await movePage(id, pageId, beforeId));
  };

  return (
    <div data-ui="PresentationEditor">
      <TitleField
        ytext={provider.document.getText(TITLE_FIELD)}
        readOnly={readOnly}
        onChange={onTitleChange}
        onEnter={() => document.querySelector<HTMLElement>('[data-ui="Whiteboard.canvas"]')?.focus()}
      />
      {someoneElse && screen === null && declined !== someoneElse.key && (
        <div className={styles.request} role="status" data-ui="PresentationEditor.presentRequest">
          <span>{t("presentRequest", { name: someoneElse.name ?? "" })}</span>
          <button type="button" className={styles.requestPrimary} onClick={() => setScreen("follow")} data-ui="PresentationEditor.joinButton">
            {t("join")}
          </button>
          <button type="button" onClick={() => setDeclined(someoneElse.key)} data-ui="PresentationEditor.declineButton">
            {t("decline")}
          </button>
        </div>
      )}
      {screen && (
        <PresentationScreen
          slides={shown}
          states={slideStates}
          slideId={screen === "follow" ? (someoneElse?.slideId ?? presented) : ownSlide}
          position={deck.settings.numberPosition}
          following={screen === "follow"}
          ended={screen === "follow" && !someoneElse}
          presenterName={someoneElse?.name ?? null}
          onGo={setPresented}
          onExit={() => {
            if (screen === "follow" && someoneElse) setDeclined(someoneElse.key);
            setScreen(null);
          }}
        />
      )}
      <div className={styles.layout}>
        <aside className={styles.list} aria-label={t("listLabel")} data-ui="PresentationEditor.slideList">
          <button
            type="button"
            className={styles.presentButton}
            disabled={shown.length === 0}
            title={shown.length === 0 ? t("noShownSlides") : undefined}
            onClick={() => void startPresenting()}
            data-ui="PresentationEditor.presentButton"
          >
            {t("present")}
          </button>
          {someoneElse && screen === null && declined === someoneElse.key && (
            <button type="button" className={styles.addButton} onClick={() => setScreen("follow")} data-ui="PresentationEditor.rejoinButton">
              {t("rejoin", { name: someoneElse.name ?? "" })}
            </button>
          )}
          {canChangeDeck && (
            <button
              type="button"
              className={styles.addButton}
              disabled={slides.length >= MAX_SLIDES}
              title={slides.length >= MAX_SLIDES ? t("slideLimit", { max: MAX_SLIDES }) : undefined}
              onClick={() => void add()}
              data-ui="PresentationEditor.addSlideButton"
            >
              {t("addSlide")}
            </button>
          )}
          {canChangeDeck && <NumberingForm deck={deck} onDone={report} />}
          <div role="list" className={styles.rows}>
            {slides.map((slide, index) => (
              <div
                key={slide.id}
                role="listitem"
                className={styles.row}
                data-ui="PresentationEditor.slideRow"
                data-id={slide.id}
                data-current={slide.id === current?.id ? "" : undefined}
                data-hidden={slide.hidden ? "" : undefined}
                data-drop={dropBefore === slide.id ? "" : undefined}
                draggable={canChangeDeck && !slide.locked}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", slide.id);
                  setDragging(slide.id);
                  // Can also be dropped on another presentation in the sidebar.
                  setDraggedPage({
                    id: slide.id,
                    title: t("slideTitle", { n: index + 1 }),
                    parentId: pageId,
                    canEdit: slide.canEdit,
                    subtree: new Set([slide.id]),
                    personal: true,
                    slide: true,
                  });
                }}
                onDragEnd={() => {
                  setDraggedPage(null);
                  setDragging(null);
                  setDropBefore(undefined);
                  // It may have gone to another presentation.
                  void refresh();
                }}
                onDragOver={(e) => {
                  if (!dragging) return;
                  e.preventDefault();
                  const box = e.currentTarget.getBoundingClientRect();
                  const after = e.clientY > box.top + box.height / 2;
                  setDropBefore(after ? (slides[index + 1]?.id ?? null) : slide.id);
                }}
                onDrop={(e) => {
                  if (!dragging) return;
                  e.preventDefault();
                  void drop(dropBefore === undefined ? slide.id : dropBefore);
                }}
              >
                <span className={styles.index} aria-hidden>
                  {index + 1}
                </span>
                <button
                  type="button"
                  className={styles.thumb}
                  aria-current={slide.id === current?.id ? "true" : undefined}
                  aria-label={t("openSlide", { n: index + 1 })}
                  onClick={() => setRequested(slide.id)}
                  data-ui="PresentationEditor.slideButton"
                >
                  {/* A picture made in the browser (a data: URL), which next/image can't optimize. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {thumbnails[slide.id] && <img src={thumbnails[slide.id]} alt="" draggable={false} />}
                  {slide.hidden && (
                    <span className={styles.hiddenMark} data-ui="PresentationEditor.hiddenStatus">
                      {t("hiddenMark")}
                    </span>
                  )}
                  {slide.number !== null && <span className={styles.thumbNumber}>{slide.number}</span>}
                  {viewers[slide.id] && (
                    <span className={styles.viewers} data-ui="PresentationEditor.viewerStatus">
                      {viewers[slide.id].slice(0, 4).map((v) => (
                        <span key={v.id} className={styles.viewerDot} style={{ background: v.color }} title={v.name} />
                      ))}
                    </span>
                  )}
                </button>
                {(slide.id === current?.id || (!readOnly && slide.canEdit)) && (
                  <div className={styles.rowActions}>
                    <Link
                      href={`/pages/${slide.id}/history`}
                      title={t("slideHistory")}
                      aria-label={t("slideHistory")}
                      data-ui="PresentationEditor.slideHistoryLink"
                    >
                      <Icon name="history" size={16} />
                    </Link>
                    {!readOnly && slide.canEdit && (
                    <>
                    <button
                      type="button"
                      title={slide.hidden ? t("showSlide") : t("hideSlide")}
                      aria-label={slide.hidden ? t("showSlide") : t("hideSlide")}
                      aria-pressed={slide.hidden}
                      onClick={async () => report(await setSlideFlag(pageId, slide.id, "hidden", !slide.hidden))}
                      data-ui="PresentationEditor.hideSlideButton"
                    >
                      <Icon name={slide.hidden ? "eyeOff" : "eye"} size={16} />
                    </button>
                    <button
                      type="button"
                      title={slide.numberHidden ? t("showNumber") : t("hideNumber")}
                      aria-label={slide.numberHidden ? t("showNumber") : t("hideNumber")}
                      aria-pressed={slide.numberHidden}
                      disabled={!deck.settings.numberingEnabled || slide.hidden}
                      onClick={async () => report(await setSlideFlag(pageId, slide.id, "numberHidden", !slide.numberHidden))}
                      data-ui="PresentationEditor.hideNumberButton"
                    >
                      <Icon name={slide.numberHidden ? "hashOff" : "hash"} size={16} />
                    </button>
                    {canChangeDeck && (
                      <button
                        type="button"
                        title={t("deleteSlide")}
                        aria-label={t("deleteSlide")}
                        onClick={() => void remove(slide, index)}
                        data-ui="PresentationEditor.deleteSlideButton"
                      >
                        <Icon name="delete" size={16} />
                      </button>
                    )}
                    </>
                    )}
                  </div>
                )}
              </div>
            ))}
            {dragging && (
              <div
                className={styles.endDrop}
                data-drop={dropBefore === null ? "" : undefined}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDropBefore(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  void drop(null);
                }}
              />
            )}
          </div>
        </aside>
        <div className={styles.stage}>
          {current ? (
            <>
              <CollabConnection key={current.id} pageId={current.id}>
                {(slideProvider) => (
                  <SlideCanvas
                    provider={slideProvider}
                    deckId={pageId}
                    readOnly={readOnly || !current.canEdit}
                    number={current.number}
                    position={deck.settings.numberPosition}
                  />
                )}
              </CollabConnection>
              {current.canReadNotes && <SlideNotes key={`notes-${current.id}`} deckId={pageId} slideId={current.id} canWrite={!readOnly && current.canEdit} />}
            </>
          ) : (
            <p className={styles.empty} data-ui="PresentationEditor.status">
              {t("noSlides")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function SlideCanvas({
  provider,
  deckId,
  readOnly,
  number,
  position,
}: {
  provider: HocuspocusProvider;
  deckId: string;
  readOnly: boolean;
  number: number | null;
  position: NumberPosition;
}) {
  useEffect(() => {
    let finish: (() => void) | null = null;
    const update = () => {
      if (provider.hasUnsyncedChanges) finish ??= beginSaving();
      else {
        finish?.();
        finish = null;
      }
    };
    update();
    provider.on("unsyncedChanges", update);
    return () => {
      provider.off("unsyncedChanges", update);
      finish?.();
    };
  }, [provider]);
  const doc = provider.document;
  const subscribe = useCallback(
    (onChange: () => void) => {
      const field = doc.getMap(SLIDE_FIELD);
      field.observe(onChange);
      return () => field.unobserve(onChange);
    },
    [doc],
  );
  const backgroundKey = useSyncExternalStore(subscribe, () => JSON.stringify(readSlideBackground(doc)));
  // Images are attachments of the presentation: everyone who can open it sees
  // them, and they can be copied between its slides as they are.
  return (
    <>
      {!readOnly && <SlideBackgroundBar doc={doc} deckId={deckId} background={JSON.parse(backgroundKey)} />}
      <WhiteboardCanvas doc={doc} readOnly={readOnly} awareness={provider.awareness} pageId={deckId} slide={{ number, position }} />
    </>
  );
}

function NumberingForm({ deck, onDone }: { deck: DeckView; onDone: (result: { error?: string }) => Promise<void> }) {
  const t = useTranslations("presentation");
  const { numberingEnabled, numberStart, numberPosition } = deck.settings;
  // Shown at once while saving; replaced when the saved values (or someone
  // else's) come back.
  const saved = `${numberingEnabled}/${numberStart}/${numberPosition}`;
  const [seen, setSeen] = useState(saved);
  const [enabled, setEnabled] = useState(numberingEnabled);
  const [position, setPosition] = useState(numberPosition);
  const [start, setStart] = useState(String(numberStart));
  if (seen !== saved) {
    setSeen(saved);
    setEnabled(numberingEnabled);
    setPosition(numberPosition);
    setStart(String(numberStart));
  }
  const save = async (patch: Partial<{ enabled: boolean; start: number; position: NumberPosition }>) => {
    const next = { enabled, start: numberStart, position, ...patch };
    setEnabled(next.enabled);
    setPosition(next.position);
    await onDone(await saveNumbering(deck.id, next));
  };
  return (
    <details className={styles.numbering} data-ui="NumberingForm">
      <summary data-ui="NumberingForm.toggle">{t("numbering")}</summary>
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => void save({ enabled: e.target.checked })}
          data-ui="NumberingForm.enabledCheckbox"
        />
        {t("numberingEnabled")}
      </label>
      <label className={styles.field}>
        {t("numberStart")}
        <input
          type="number"
          min={MIN_NUMBER_START}
          max={MAX_NUMBER_START}
          value={start}
          onChange={(e) => setStart(e.target.value)}
          onBlur={() => {
            const value = Number(start);
            if (start.trim() !== "" && isNumberStart(value)) {
              if (value !== numberStart) void save({ start: value });
            } else setStart(String(numberStart));
          }}
          data-ui="NumberingForm.startInput"
        />
      </label>
      <label className={styles.field}>
        {t("numberPosition")}
        <select
          value={position}
          onChange={(e) => void save({ position: e.target.value as NumberPosition })}
          data-ui="NumberingForm.positionSelect"
        >
          {NUMBER_POSITIONS.map((p) => (
            <option key={p} value={p}>
              {t(`positions.${p}`)}
            </option>
          ))}
        </select>
      </label>
    </details>
  );
}
