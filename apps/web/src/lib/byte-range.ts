// The part of a file a `Range: bytes=...` request header asks for, so media
// can be streamed and seeked (Safari won't play a video whose server
// doesn't answer ranges with 206). One range only: a list of them is served
// whole, as RFC 9110 allows. No dependencies (unit tests:
// test/byte-range.test.ts).

export type ByteRange = { start: number; end: number }; // inclusive

// null: no (usable) range — send the whole file. "unsatisfiable": answer 416.
export function parseByteRange(header: string | null, size: number): ByteRange | "unsatisfiable" | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return null;
  if (m[1] === "") {
    // The last n bytes.
    const n = Number(m[2]);
    if (n === 0) return "unsatisfiable";
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(m[1]);
  const end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (start >= size) return "unsatisfiable";
  if (end < start) return null;
  return { start, end };
}
