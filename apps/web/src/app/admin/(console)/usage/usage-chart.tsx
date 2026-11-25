"use client";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import type { DayActivity } from "@/lib/usage-stats";
import { niceTicks } from "@/lib/usage-format";
import styles from "./usage.module.css";

const SERIES = [
  { key: "web", color: "var(--usage-web)" },
  { key: "api", color: "var(--usage-api)" },
  { key: "mcp", color: "var(--usage-mcp)" },
] as const;

const WIDTH = 720;
const HEIGHT = 200;
const LEFT = 40;
const BOTTOM = 22;
const TOP = 6;

// Actions per day, stacked by channel: edits from the editor, API calls and
// MCP calls. Hovering a day shows its numbers (the same are in the table
// below the chart).
export function UsageChart({ days }: { days: DayActivity[] }) {
  const t = useTranslations("admin.usage");
  const format = useFormatter();
  const [active, setActive] = useState<number | null>(null);

  const totals = days.map((d) => d.web + d.api + d.mcp);
  const ticks = niceTicks(Math.max(0, ...totals));
  const top = ticks.at(-1)!;
  const plotW = WIDTH - LEFT;
  const plotH = HEIGHT - TOP - BOTTOM;
  const band = plotW / Math.max(1, days.length);
  const barW = Math.max(1, Math.min(24, band - 2));
  const y = (v: number) => TOP + plotH - (v / top) * plotH;
  const dayLabel = (day: string) => format.dateTime(new Date(`${day}T00:00:00Z`), { month: "numeric", day: "numeric", timeZone: "UTC" });
  // About six date labels, whatever the period.
  const labelEvery = Math.max(1, Math.ceil(days.length / 6));

  const hovered = active !== null ? days[active] : null;
  return (
    <div data-ui="UsageChart">
      <div className={styles.legend} data-ui="UsageChart.legend">
        {SERIES.map((s) => (
          <span key={s.key} className={styles.legendItem}>
            <span className={styles.swatch} style={{ background: s.color }} />
            {t(`series.${s.key}`)}
          </span>
        ))}
      </div>
      <div className={styles.chart} onMouseLeave={() => setActive(null)}>
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={t("chartLabel")}>
          {ticks.map((v) => (
            <g key={v}>
              <line className={styles.grid} x1={LEFT} x2={WIDTH} y1={y(v)} y2={y(v)} />
              <text className={styles.axisText} x={LEFT - 6} y={y(v) + 4} textAnchor="end">
                {format.number(v, { notation: "compact" })}
              </text>
            </g>
          ))}
          {days.map((d, i) => {
            const x = LEFT + i * band + (band - barW) / 2;
            let base = 0;
            return (
              <g key={d.day}>
                <rect
                  className={i === active ? styles.hoverBandActive : styles.hoverBand}
                  x={LEFT + i * band}
                  y={TOP}
                  width={band}
                  height={plotH}
                  onMouseEnter={() => setActive(i)}
                />
                {SERIES.map((s) => {
                  const value = d[s.key];
                  if (value === 0) return null;
                  const y0 = y(base);
                  base += value;
                  const y1 = y(base);
                  // A surface gap between stacked segments.
                  const h = Math.max(1, y0 - y1 - (base > value ? 1 : 0));
                  return <rect key={s.key} x={x} y={y1} width={barW} height={h} fill={s.color} pointerEvents="none" />;
                })}
                {i % labelEvery === 0 && (
                  <text className={styles.axisText} x={LEFT + i * band + band / 2} y={HEIGHT - 6} textAnchor="middle">
                    {dayLabel(d.day)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        {hovered && (
          <div
            className={styles.tooltip}
            style={active! > days.length / 2 ? { right: `${100 - ((LEFT + active! * band) / WIDTH) * 100}%` } : { left: `${((LEFT + (active! + 1) * band) / WIDTH) * 100}%` }}
            data-ui="UsageChart.tooltip"
          >
            <strong>{format.dateTime(new Date(`${hovered.day}T00:00:00Z`), { dateStyle: "medium", timeZone: "UTC" })}</strong>
            {SERIES.map((s) => (
              <div key={s.key} className={styles.tooltipRow}>
                <span className={styles.swatch} style={{ background: s.color }} />
                {t(`series.${s.key}`)}
                <span>{format.number(hovered[s.key])}</span>
              </div>
            ))}
            <div className={styles.tooltipRow}>
              {t("activePeople")}
              <span>{format.number(hovered.people)}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
