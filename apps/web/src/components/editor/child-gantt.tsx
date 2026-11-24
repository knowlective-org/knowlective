"use client";

import { useFormatter, useLocale, useTranslations } from "next-intl";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { useDisplayTitle } from "@/i18n/use-display-title";
import type { ChildTableRow } from "@/lib/page-property-types";
import { todayKey } from "./calendar";
import { CalendarAddInput } from "./calendar-add-input";
import { type GanttRange, type Span, ganttDays, isLongGanttRange, moveSpan, placeSpan, resizeSpan, shiftAnchor, weekdayOf } from "./gantt";
import { PageLink } from "./page-link";
import styles from "./child-calendar-block.module.css";

// The child page calendar as a Gantt chart: a row per page with a bar from its
// start date to its end date, over a week to three years. Dragging
// a bar moves both dates, dragging its ends changes one (arrow keys on a bar
// do the same; with Shift, its end). The period looked at is each viewer's own.

// The narrowest a day can be before the chart scrolls sideways.
const MIN_DAY_WIDTH: Record<GanttRange, number> = { week: 72, month: 24, quarter: 7, year: 2, threeYears: 1 };

export type GanttSpan = Span & {
  // The page has its own end date (else a bar moved stays a single day).
  hasEnd: boolean;
};

type Drag = { id: string; edge: "move" | "start" | "end"; x: number; dayWidth: number; delta: number };

const localDate = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d);
};

function changed(span: GanttSpan, edge: Drag["edge"], delta: number): { start: string; end: string } {
  if (edge === "move") {
    const next = moveSpan(span, delta);
    return { start: next.start, end: span.hasEnd ? next.end : "" };
  }
  return resizeSpan(span, edge, delta);
}

export function ChildGantt({
  range,
  rows,
  spanOf,
  saving,
  settable,
  resizable,
  canAdd,
  onChange,
  onAdd,
}: {
  range: GanttRange;
  rows: ChildTableRow[];
  spanOf: (row: ChildTableRow) => GanttSpan | null;
  saving: boolean;
  // Dates can be set (a date column, and the viewer can edit the page).
  settable: boolean;
  // There is a column for the end date.
  resizable: boolean;
  canAdd: boolean;
  onChange: (row: ChildTableRow, start: string, end: string) => Promise<void>;
  onAdd: (date: string, title: string) => Promise<void>;
}) {
  const t = useTranslations("editor.childCalendar");
  const format = useFormatter();
  const locale = useLocale();
  const displayTitle = useDisplayTitle();
  const root = useRef<HTMLDivElement>(null);
  const timeline = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState(() => todayKey());
  const [drag, setDrag] = useState<Drag | null>(null);
  const [adding, setAdding] = useState(false);
  const days = useMemo(() => ganttDays(anchor, range), [anchor, range]);
  const today = todayKey();

  const items = rows.flatMap((row) => {
    const span = spanOf(row);
    return span ? [{ row, span }] : [];
  });
  const undated = rows.filter((row) => !spanOf(row));
  const shownSpan = (id: string, span: GanttSpan): Span => {
    if (drag?.id !== id || drag.delta === 0) return span;
    const next = drag.edge === "move" ? moveSpan(span, drag.delta) : resizeSpan(span, drag.edge, drag.delta);
    return next;
  };
  const shown = items
    .flatMap(({ row, span }) => {
      const at = shownSpan(row.id, span);
      const place = placeSpan(at, days);
      // The bar being dragged stays in its row even off the days shown.
      return place || drag?.id === row.id ? [{ row, span, at, place }] : [];
    })
    .sort((a, b) => a.span.start.localeCompare(b.span.start) || a.span.end.localeCompare(b.span.end));
  const outside = items.length - shown.length;

  // The latest values, for the listeners below.
  const live = useRef({ items, onChange, settable, resizable, days });
  useEffect(() => {
    live.current = { items, onChange, settable, resizable, days };
  });

  // A period wider than the block opens with today in the middle of what's
  // visible right of the titles (else at its start).
  useEffect(() => {
    const el = scroller.current;
    const width = timeline.current?.getBoundingClientRect().width;
    if (!el || !width) return;
    const at = days.indexOf(todayKey());
    const titles = el.scrollWidth - width;
    el.scrollLeft = at < 0 ? 0 : Math.max(0, ((at + 0.5) / days.length) * width - (el.clientWidth - titles) / 2);
  }, [days]);

  // Listeners on the chart's own element: the editor would otherwise take a
  // press on a bar for its own selection (as the board's cards).
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let current: Drag | null = null;
    let pointer: number | null = null;
    let swallowClick = false;
    const barOf = (target: EventTarget | null) => (target as HTMLElement | null)?.closest<HTMLElement>("[data-bar]") ?? null;
    const find = (id: string) => live.current.items.find((i) => i.row.id === id);
    const canChange = (id: string) => live.current.settable && !!find(id)?.row.canEdit;

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const bar = barOf(e.target);
      const id = bar?.dataset.bar;
      if (!id || !canChange(id)) return;
      const edge = (e.target as HTMLElement).closest<HTMLElement>("[data-edge]")?.dataset.edge as "start" | "end" | undefined;
      if (edge && !live.current.resizable) return;
      const width = timeline.current?.getBoundingClientRect().width ?? 0;
      current = { id, edge: edge ?? "move", x: e.clientX, dayWidth: width / live.current.days.length || 1, delta: 0 };
      pointer = e.pointerId;
      swallowClick = false;
      el.setPointerCapture(e.pointerId);
      setDrag(current);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!current || e.pointerId !== pointer) return;
      e.preventDefault();
      const delta = Math.round((e.clientX - current.x) / current.dayWidth);
      if (delta === current.delta) return;
      current = { ...current, delta };
      // Once it has moved, letting go isn't a click on the page's link.
      swallowClick = true;
      setDrag(current);
    };
    const finish = (commit: boolean) => {
      const ended = current;
      current = null;
      pointer = null;
      setDrag(null);
      if (!ended || !commit || ended.delta === 0) return;
      const item = find(ended.id);
      if (!item) return;
      const next = changed(item.span, ended.edge, ended.delta);
      void live.current.onChange(item.row, next.start, next.end);
    };
    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerId === pointer) finish(true);
    };
    const onPointerCancel = (e: PointerEvent) => {
      if (e.pointerId === pointer) finish(false);
    };
    const onClick = (e: MouseEvent) => {
      if (!swallowClick) return;
      swallowClick = false;
      e.preventDefault();
      e.stopPropagation();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && current) {
        e.stopPropagation();
        finish(false);
        return;
      }
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const id = barOf(e.target)?.dataset.bar;
      if (!id || !canChange(id) || (e.shiftKey && !live.current.resizable)) return;
      e.preventDefault();
      e.stopPropagation();
      const item = find(id);
      if (!item) return;
      const next = changed(item.span, e.shiftKey ? "end" : "move", e.key === "ArrowLeft" ? -1 : 1);
      void live.current.onChange(item.row, next.start, next.end);
    };
    // The block around the chart can be dragged: a native drag (of that
    // block, so it never reaches this element) would cancel the pointer in
    // the middle of moving a bar. Stopped at the press, which also stops the
    // press from focusing the bar, so that's done here.
    const stopMouse = (e: MouseEvent) => {
      const bar = barOf(e.target);
      if (!bar) return;
      e.stopPropagation();
      e.preventDefault();
      if (bar.tabIndex >= 0) bar.focus({ preventScroll: true });
    };
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerCancel);
    el.addEventListener("click", onClick, true);
    el.addEventListener("keydown", onKeyDown);
    el.addEventListener("mousedown", stopMouse);
    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerCancel);
      el.removeEventListener("click", onClick, true);
      el.removeEventListener("keydown", onKeyDown);
      el.removeEventListener("mousedown", stopMouse);
    };
  }, []);

  const first = days[0];
  const last = days[days.length - 1];
  const long = isLongGanttRange(range);
  const label =
    range === "month"
      ? format.dateTime(localDate(first), { year: "numeric", month: "long" })
      : range === "year"
        ? format.dateTime(localDate(first), { year: "numeric" })
        : format.dateTimeRange(
            localDate(first),
            localDate(last),
            range === "threeYears" ? { year: "numeric" } : range === "week" ? { year: "numeric", month: "short", day: "numeric" } : { year: "numeric", month: "short" },
          );

  // The months over the days, each as wide as its days.
  const months: { key: string; from: number; count: number }[] = [];
  days.forEach((date, i) => {
    const key = date.slice(0, 7);
    const lastMonth = months[months.length - 1];
    if (lastMonth?.key === key) lastMonth.count++;
    else months.push({ key, from: i, count: 1 });
  });
  const dayLabel = (date: string) => {
    if (range === "week") {
      return new Intl.DateTimeFormat(locale, { month: "numeric", day: "numeric", weekday: "short", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
    }
    // Three months: only the start of each week fits.
    if (range === "quarter" && weekdayOf(date) !== 0) return "";
    return String(Number(date.slice(8)));
  };
  const todayAt = days.indexOf(today);
  const addDate = todayAt >= 0 ? today : first;
  // A long period's columns: its months, as wide as their days.
  const monthColumns = months.map((m) => `minmax(0, ${m.count}fr)`).join(" ");
  const years: { key: string; from: number; count: number }[] = [];
  months.forEach((m, i) => {
    const key = m.key.slice(0, 4);
    const lastYear = years[years.length - 1];
    if (lastYear?.key === key) lastYear.count++;
    else years.push({ key, from: i, count: 1 });
  });

  return (
    <div ref={root} data-ui="ChildCalendarBlock.gantt" aria-busy={saving}>
      <div className={styles.nav}>
        <button type="button" className={styles.navButton} onClick={() => setAnchor(shiftAnchor(anchor, range, -1))} aria-label={t("previousPeriod")} data-ui="ChildCalendarBlock.previousButton">
          ‹
        </button>
        <span className={styles.monthLabel} aria-live="polite" data-ui="ChildCalendarBlock.monthStatus">
          {label}
        </span>
        <button type="button" className={styles.navButton} onClick={() => setAnchor(shiftAnchor(anchor, range, 1))} aria-label={t("nextPeriod")} data-ui="ChildCalendarBlock.nextButton">
          ›
        </button>
        <button type="button" className={styles.todayButton} onClick={() => setAnchor(todayKey())} data-ui="ChildCalendarBlock.todayButton">
          {t("today")}
        </button>
      </div>

      <div ref={scroller} className={styles.ganttScroll}>
        <div
          className={styles.gantt}
          role="grid"
          aria-label={t("ganttLabel")}
          data-range={range}
          style={{ "--gantt-days": days.length, "--gantt-day-min": `${MIN_DAY_WIDTH[range]}px` } as CSSProperties}
        >
          <div className={styles.ganttRow} role="row" data-head>
            <div className={styles.ganttTitle} role="columnheader">
              {t("ganttPage")}
            </div>
            <div ref={timeline} className={styles.ganttHead} style={long ? { gridTemplateColumns: monthColumns } : undefined}>
              {long &&
                years.map((y) => (
                  <div key={y.key} className={styles.ganttMonth} style={{ gridColumn: `${y.from + 1} / span ${y.count}`, gridRow: 1 }} data-ui="ChildCalendarBlock.ganttYear" data-id={y.key}>
                    {format.dateTime(localDate(`${y.key}-01-01`), { year: "numeric" })}
                  </div>
                ))}
              {range !== "week" &&
                months.map((m, i) => (
                  <div
                    key={m.key}
                    role={long ? "columnheader" : undefined}
                    className={styles.ganttMonth}
                    style={long ? { gridColumn: i + 1, gridRow: 2 } : { gridColumn: `${m.from + 1} / span ${m.count}` }}
                    data-long={long || undefined}
                    data-today={(long && today.startsWith(m.key)) || undefined}
                    data-ui="ChildCalendarBlock.ganttMonth"
                    data-id={m.key}
                  >
                    {long ? Number(m.key.slice(5)) : format.dateTime(localDate(`${m.key}-01`), { month: "short" })}
                  </div>
                ))}
              {!long &&
                days.map((date, i) => (
                  <div
                    key={date}
                    role="columnheader"
                    aria-label={date}
                    className={styles.ganttDay}
                    style={{ gridColumn: i + 1, gridRow: range === "week" ? 1 : 2 }}
                    data-today={date === today || undefined}
                    data-weekend={weekdayOf(date) % 6 === 0 || undefined}
                    data-ui="ChildCalendarBlock.ganttDay"
                    data-id={date}
                  >
                    {dayLabel(date)}
                  </div>
                ))}
            </div>
          </div>

          <div className={styles.ganttBody}>
            {/* One set of day columns behind every row. */}
            <div className={styles.ganttLanes} style={long ? { gridTemplateColumns: monthColumns } : undefined} aria-hidden>
              {long
                ? months.map((m) => <div key={m.key} />)
                : days.map((date) => <div key={date} data-today={date === today || undefined} data-weekend={weekdayOf(date) % 6 === 0 || undefined} />)}
              {long && todayAt >= 0 && <span className={styles.ganttTodayLine} style={{ left: `${(todayAt / days.length) * 100}%`, width: `max(2px, ${100 / days.length}%)` }} />}
            </div>
            {shown.map(({ row, at, place }) => {
              const editable = settable && row.canEdit;
              const title = `${row.icon ? `${row.icon} ` : ""}${displayTitle(row.title)}`;
              return (
                <div key={row.id} className={styles.ganttRow} role="row" data-ui="ChildCalendarBlock.ganttRow" data-id={row.id}>
                  <div className={styles.ganttTitle} role="rowheader">
                    <PageLink href={`/pages/${row.id}`} className={styles.cardLink} draggable={false} data-ui="ChildCalendarBlock.ganttLink">
                      {title}
                    </PageLink>
                  </div>
                  <div className={styles.ganttTrack} role="gridcell">
                    {place && (
                      <div
                        className={styles.ganttBar}
                        style={{ marginLeft: `${(place.from / days.length) * 100}%`, width: `${((place.to - place.from + 1) / days.length) * 100}%` }}
                        data-bar={row.id}
                        data-editable={editable || undefined}
                        data-dragging={drag?.id === row.id || undefined}
                        data-before={place.before || undefined}
                        data-after={place.after || undefined}
                        data-start={at.start}
                        data-end={at.end}
                        tabIndex={editable ? 0 : undefined}
                        role={editable ? "group" : undefined}
                        aria-label={t("ganttBar", { title: displayTitle(row.title), start: at.start, end: at.end })}
                        title={`${title} (${at.start} – ${at.end})`}
                        data-ui="ChildCalendarBlock.ganttBar"
                      >
                        {editable && resizable && !place.before && <span className={styles.ganttHandle} data-edge="start" data-ui="ChildCalendarBlock.ganttStartHandle" />}
                        <span className={styles.ganttBarText}>{title}</span>
                        {editable && resizable && !place.after && <span className={styles.ganttHandle} data-edge="end" data-ui="ChildCalendarBlock.ganttEndHandle" />}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            {shown.length === 0 && (
              <div className={styles.ganttEmpty} data-ui="ChildCalendarBlock.ganttEmptyStatus">
                {t("ganttEmpty")}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className={styles.ganttFoot}>
        {canAdd &&
          (adding ? (
            <CalendarAddInput
              placeholder={t("newPagePlaceholder")}
              onDone={async (text) => {
                setAdding(false);
                if (text !== null) await onAdd(addDate, text);
              }}
            />
          ) : (
            <button type="button" className={styles.todayButton} onClick={() => setAdding(true)} data-ui="ChildCalendarBlock.ganttAddButton">
              ＋ {t("ganttAdd")}
            </button>
          ))}
        {outside > 0 && (
          <span className={styles.muted} data-ui="ChildCalendarBlock.ganttOutsideStatus">
            {t("ganttOutside", { count: outside })}
          </span>
        )}
      </div>

      {undated.length > 0 && (
        <section className={styles.undated} data-ui="ChildCalendarBlock.undated" aria-label={t("undated")}>
          <header className={styles.undatedHeader}>
            {t("undated")} <span className={styles.count}>{undated.length}</span>
          </header>
          <div className={styles.undatedCards} role="list">
            {undated.map((row) => (
              <div key={row.id} className={styles.undatedItem} role="listitem">
                <div className={styles.card} data-ui="ChildCalendarBlock.card" data-id={row.id}>
                  <PageLink href={`/pages/${row.id}`} className={styles.cardLink} draggable={false} data-ui="ChildCalendarBlock.cardLink">
                    {row.icon ? `${row.icon} ` : ""}
                    {displayTitle(row.title)}
                  </PageLink>
                </div>
                {settable && row.canEdit && (
                  <input
                    type="date"
                    max="9999-12-31"
                    className={styles.dateInput}
                    aria-label={t("setDate", { title: displayTitle(row.title) })}
                    onChange={(e) => e.target.value && void onChange(row, e.target.value, "")}
                    data-ui="ChildCalendarBlock.dateInput"
                    data-id={row.id}
                  />
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
