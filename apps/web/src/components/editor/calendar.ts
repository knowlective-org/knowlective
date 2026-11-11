// The child page calendar's month (child-calendar-block.tsx): its weeks of
// days, and dates as the DATE column keeps them ("YYYY-MM-DD", local).
// No dependencies (unit tests: test/calendar.test.ts).

export type Month = { year: number; month: number }; // month: 1–12
export type CalendarDay = { date: string; day: number; inMonth: boolean };

const pad = (n: number) => String(n).padStart(2, "0");

export const dateKey = (year: number, month: number, day: number) => `${year}-${pad(month)}-${pad(day)}`;

export function todayKey(now = new Date()): string {
  return dateKey(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function monthOf(date: string): Month | null {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(date);
  return m ? { year: Number(m[1]), month: Number(m[2]) } : null;
}

export function addMonths({ year, month }: Month, n: number): Month {
  const index = year * 12 + (month - 1) + n;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

// The weeks shown for a month: whole weeks from the one holding its first
// day to the one holding its last, starting on `weekStart` (0 = Sunday,
// 1 = Monday). Days of the months around it fill the first and last weeks.
export function monthWeeks({ year, month }: Month, weekStart: 0 | 1 = 0): CalendarDay[][] {
  // Noon UTC: no daylight-saving or time zone shifts.
  const first = new Date(Date.UTC(year, month - 1, 1, 12));
  const lead = (first.getUTCDay() - weekStart + 7) % 7;
  const daysInMonth = new Date(Date.UTC(year, month, 0, 12)).getUTCDate();
  const count = Math.ceil((lead + daysInMonth) / 7) * 7;
  const weeks: CalendarDay[][] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(Date.UTC(year, month - 1, 1 - lead + i, 12));
    const day: CalendarDay = {
      date: dateKey(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()),
      day: d.getUTCDate(),
      inMonth: d.getUTCMonth() === month - 1,
    };
    if (i % 7 === 0) weeks.push([]);
    weeks[weeks.length - 1].push(day);
  }
  return weeks;
}

// A built-in column's ISO time as the local day it fell on.
export function localDay(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : dateKey(d.getFullYear(), d.getMonth() + 1, d.getDate());
}
