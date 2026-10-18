// "1 hour", "24 hours", "7 days": a length of time in the largest unit that
// keeps it whole (days from two on). `t` is the "duration" translator, from
// useTranslations() or getTranslations().

type DurationTranslator = (key: "minute" | "hour" | "day", values: { count: number }) => string;

export function formatDuration(t: DurationTranslator, minutes: number): string {
  const day = 24 * 60;
  if (minutes >= 2 * day && minutes % day === 0) return t("day", { count: minutes / day });
  if (minutes % 60 === 0) return t("hour", { count: minutes / 60 });
  return t("minute", { count: minutes });
}
