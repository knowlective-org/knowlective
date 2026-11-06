// Changing a piece of code's indentation to another unit (2 or 4 spaces, or
// a tab), for the code block's "Format" in languages there's no formatter for.
// Each line keeps its level: the code's own unit is found from its lines (a
// tab, or the smallest step between space indents), and every level of it
// becomes one of the new unit. Spaces left over (alignment) stay.
//
// Dependency-free: unit-tested (test/reindent.test.ts).

export type IndentUnit = "2" | "4" | "tab";

export const INDENT_UNITS: readonly IndentUnit[] = ["2", "4", "tab"];

export function indentString(unit: IndentUnit): string {
  return unit === "tab" ? "\t" : " ".repeat(Number(unit));
}

// The spaces one level takes in the code: the greatest common divisor of the
// lines' space indents (2 for 2, 4, 6; 4 for 4, 8). 0 when no line starts with spaces.
function spaceUnit(lines: string[]): number {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  let unit = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    const spaces = /^\t* */.exec(line)![0].replace(/\t/g, "").length;
    if (spaces > 0) unit = gcd(unit, spaces);
  }
  return unit;
}

export function reindent(code: string, unit: IndentUnit): string {
  const lines = code.split("\n");
  const step = spaceUnit(lines);
  const indent = indentString(unit);
  return lines
    .map((line) => {
      const [lead] = /^[ \t]*/.exec(line)!;
      if (!line.trim()) return "";
      const tabs = (lead.match(/\t/g) ?? []).length;
      const spaces = lead.length - tabs;
      const levels = tabs + (step ? Math.floor(spaces / step) : 0);
      const rest = step ? spaces % step : spaces;
      return indent.repeat(levels) + " ".repeat(rest) + line.slice(lead.length);
    })
    .join("\n");
}
