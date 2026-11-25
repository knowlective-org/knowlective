// Byte counts in a unit people read (1024-based), for the usage dashboard.
// Dependency-free (unit-tested).

export type ByteUnit = "B" | "KB" | "MB" | "GB" | "TB";

export function bytesUnit(bytes: number): { value: number; unit: ByteUnit } {
  const units: ByteUnit[] = ["B", "KB", "MB", "GB", "TB"];
  let value = Math.max(0, bytes);
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return { value, unit: units[i] };
}

// A "nice" top for a bar chart's axis (1, 2 or 5 times a power of ten), at
// least `max`, and its tick values from zero.
export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  const rough = max / count;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= rough) ?? 10 * power;
  const ticks: number[] = [];
  for (let v = 0; v < max + step; v += step) {
    ticks.push(Math.round(v * 1e6) / 1e6);
    if (v >= max) break;
  }
  return ticks;
}
