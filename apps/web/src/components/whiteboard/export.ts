import { type BoxItem, type ItemColor, type Stroke, type WhiteboardItem, hexagonInset, isBox } from "@/lib/whiteboard";
import { boundsOf, connectorPoints, endLabelPlace, hexagonPolygon, hopCrossings, lineRect, midpointOf, routePath, spreadEnds } from "./geometry";
import { type HighlightColor, type TextColor, type TextMark, styledRuns, textStyleCss } from "@/lib/whiteboard-marks";
import { parseRichTextAt } from "./rich-text";
import { ARROW_HEADS, STROKE_DRAW } from "./stroke";

// A whiteboard as one SVG file, for the page menu's export (and, drawn onto a
// canvas, PNG). Shapes and lines are SVG; text is HTML in <foreignObject>,
// so it wraps and shows its lists as on screen. Images are put in as data:
// URLs (`images`, by their src), so the file stands alone.
// No DOM needed (unit tests: test/whiteboard-export.test.ts).

export type ExportColors = {
  items: Record<ItemColor, string>;
  // The text colors (lib/whiteboard-marks.ts).
  text: Record<TextColor, string>;
  // The highlights (lib/whiteboard-marks.ts).
  highlight: Record<HighlightColor, string>;
  board: string;
  ink: string;
  line: string;
  muted: string;
};

const PADDING = 40;
const FONT = `-apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", Meiryo, sans-serif`;

// For a presentation's slides. `font`: instead of the system fonts.
// `plainLists`: list markers as text one can measure (the PDF places text
// itself). `noShadow`: without the sticky notes' shadow (a filter, which a
// PDF would have to rasterize).
// `background`: a slide's (a color, or an image as a data: URL).
export type SvgOptions = { font?: string; plainLists?: boolean; noShadow?: boolean; background?: { color?: string; image?: string } };

const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const kebab = (name: string) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

// Part of a text as XHTML, in its styles (lib/whiteboard-marks.ts).
function styledHtml(text: string, marks: TextMark[], span: { from: number; to: number }, colors: ExportColors): string {
  return styledRuns(text, marks, span.from, span.to)
    .map((run) => {
      if (!run.style) return escapeXml(run.text);
      const css = Object.entries(textStyleCss(run.style, (c) => colors.text[c], (c) => colors.highlight[c]))
        .map(([k, v]) => `${kebab(k)}:${v}`)
        .join(";");
      return `<span style="${escapeXml(css)}">${escapeXml(run.text)}</span>`;
    })
    .join("");
}

// An item's text as XHTML: lines, and lists as lists (rich-text.ts), styled.
function richHtml(text: string, marks: TextMark[], colors: ExportColors, plainLists = false): string {
  return parseRichTextAt(text)
    .map((block) => {
      if (block.kind === "text") return `<div style="white-space:pre-wrap">${styledHtml(text, marks, block.span, colors)}</div>`;
      if (plainLists) {
        return block.items
          .map((item, i) => {
            const marker = block.kind === "bullet" ? "•" : `${block.start + i}.`;
            return (
              `<div style="position:relative;padding-left:1.3em"><span style="position:absolute;left:0">${marker}</span>` +
              `${styledHtml(text, marks, item, colors)}</div>`
            );
          })
          .join("");
      }
      const items = block.items.map((item) => `<li>${styledHtml(text, marks, item, colors)}</li>`).join("");
      return block.kind === "bullet"
        ? `<ul style="margin:0;padding-left:1.3em">${items}</ul>`
        : `<ol start="${block.start}" style="margin:0;padding-left:1.3em">${items}</ol>`;
    })
    .join("");
}

// HTML in the SVG: `style` for the outer box (a flex container placing it).
const html = (x: number, y: number, w: number, h: number, style: string, inner: string) =>
  `<foreignObject x="${x}" y="${y}" width="${w}" height="${h}" overflow="visible">` +
  `<div xmlns="http://www.w3.org/1999/xhtml" style="box-sizing:border-box;width:${w}px;height:${h}px;display:flex;${style}">${inner}</div>` +
  `</foreignObject>`;

function boxSvg(b: BoxItem, colors: ExportColors, images: Map<string, string>, options: SvgOptions): { shape: string; text: string } {
  // "none" rather than the CSS keyword, for SVG viewers outside browsers.
  const fill = b.color === "transparent" ? "none" : colors.items[b.color];
  const stroke = `stroke="${colors.line}" stroke-width="2"`;
  let shape = "";
  let pad = "0";
  let font = "font-size:14px;line-height:1.4";
  switch (b.type) {
    case "sticky":
      shape = `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="${fill}"${b.color === "transparent" || options.noShadow ? "" : ' filter="url(#wb-shadow)"'}/>`;
      pad = "8px 10px";
      break;
    case "rect":
      shape = `<rect x="${b.x + 1}" y="${b.y + 1}" width="${b.w - 2}" height="${b.h - 2}" rx="6" fill="${fill}" ${stroke}/>`;
      pad = "6px 10px";
      font = "font-size:14px";
      break;
    case "ellipse":
      shape = `<ellipse cx="${b.x + b.w / 2}" cy="${b.y + b.h / 2}" rx="${b.w / 2 - 1}" ry="${b.h / 2 - 1}" fill="${fill}" ${stroke}/>`;
      pad = `6px ${10 + Math.round(b.w * 0.15)}px`;
      font = "font-size:14px";
      break;
    case "diamond": {
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;
      shape = `<polygon points="${cx},${b.y} ${b.x + b.w},${cy} ${cx},${b.y + b.h} ${b.x},${cy}" fill="${fill}" ${stroke}/>`;
      pad = `${Math.round(b.h * 0.12)}px ${Math.round(b.w * 0.22)}px`;
      font = "font-size:14px";
      break;
    }
    case "hexagon":
      shape = `<polygon transform="translate(${b.x} ${b.y})" points="${hexagonPolygon(b.w, b.h)}" fill="${fill}" ${stroke}/>`;
      pad = `6px ${Math.round(hexagonInset(b.h) * 0.8)}px`;
      font = "font-size:14px";
      break;
    case "text":
      pad = "2px 4px";
      font = "font-size:16px;line-height:1.35";
      break;
    case "image": {
      const data = images.get(b.src);
      return {
        shape: data
          ? `<image x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" href="${escapeXml(data)}" preserveAspectRatio="xMidYMid meet"/>`
          : `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="${colors.items.gray}"/>`,
        text: "",
      };
    }
  }
  if (b.fontSize) font = `font-size:${b.fontSize}px;line-height:1.3`;
  const text = b.text.trim()
    ? html(
        b.x + b.textX,
        b.y + b.textY,
        b.w,
        b.h,
        `align-items:safe center;padding:${pad};${font};color:${colors.ink};overflow-wrap:anywhere`,
        `<div style="width:100%">${richHtml(b.text, b.textMarks, colors, options.plainLists)}</div>`,
      )
    : "";
  return { shape, text };
}

const markerFor = (arrows: string, end: "start" | "end", large: boolean) =>
  (end === "start" ? arrows === "start" || arrows === "both" : arrows === "end" || arrows === "both")
    ? ` marker-${end}="url(#wb-arrow${large ? "-large" : ""})"`
    : "";

const arrowMarker = (id: string, head: { size: number; refX: number }, color: string) =>
  `<marker id="${id}" viewBox="0 0 10 10" refX="${head.refX}" refY="5" markerWidth="${head.size}" markerHeight="${head.size}" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${color}"/></marker>`;

// The board (every item that can be shown, back to front: readItems()) as
// an SVG document, with its size.
export function whiteboardSvg(
  items: WhiteboardItem[],
  colors: ExportColors,
  images: Map<string, string> = new Map(),
  // A fixed area to draw (a slide), instead of everything on the board.
  frame?: { x: number; y: number; w: number; h: number },
  options: SvgOptions = {},
): {
  svg: string;
  width: number;
  height: number;
  // The drawing back to front, each item's shape and text apart, and an SVG
  // (without the board's background) around any of it.
  layers: { shapes: string; text: string }[];
  layerSvg: (inner: string) => string;
} {
  const byId = new Map(items.map((i) => [i.id, i]));
  const connectors = spreadEnds(
    items.flatMap((i) => {
      if (i.type !== "connector") return [];
      const from = byId.get(i.from);
      const to = byId.get(i.to);
      if (!isBox(from) || !isBox(to)) return [];
      return [{ item: i, from: i.from, to: i.to, pair: [i.from, i.to].sort().join(" "), points: connectorPoints(from, to, i.route, { from: i.fromSide, to: i.toSide }) }];
    }),
    (id) => {
      const box = byId.get(id);
      return isBox(box) ? box : undefined;
    },
  );
  const crossings = hopCrossings(connectors);
  const rects = [
    ...items.flatMap((i) => (isBox(i) ? [i] : i.type === "line" ? [lineRect(i)] : [])),
    ...connectors.flatMap((c) => c.points.map((p) => ({ x: p.x, y: p.y, w: 0, h: 0 }))),
  ];
  const bounds = boundsOf(rects) ?? { x: 0, y: 0, w: 0, h: 0 };
  const x0 = frame ? frame.x : Math.floor(bounds.x - PADDING);
  const y0 = frame ? frame.y : Math.floor(bounds.y - PADDING);
  const width = frame ? frame.w : Math.ceil(bounds.w + PADDING * 2);
  const height = frame ? frame.h : Math.ceil(bounds.h + PADDING * 2);

  // A line in its stroke, as on screen (STROKE_DRAW).
  const strokePath = (d: string, stroke: Stroke, arrows: string) => {
    const draw = STROKE_DRAW[stroke];
    const dash = draw.dash ? ` stroke-dasharray="${draw.dash}"` : "";
    const markers = `${markerFor(arrows, "start", draw.large)}${markerFor(arrows, "end", draw.large)}`;
    const line = `<path d="${d}" fill="none" stroke="${colors.line}" stroke-width="${draw.width}"${dash}${draw.gap ? "" : markers}/>`;
    // A double line's arrowheads over its middle (as on screen).
    return draw.gap
      ? `${line}<path d="${d}" fill="none" stroke="${colors.board}" stroke-width="${draw.gap}"/><path d="${d}" fill="none" stroke="none"${markers}/>`
      : line;
  };
  const connectorLines = connectors.map((c, i) => strokePath(routePath(c.points, crossings[i]), c.item.stroke, c.item.arrows)).join("");
  const fronts = items.map((i) => {
    if (isBox(i)) return boxSvg(i, colors, images, options);
    if (i.type === "line") {
      return { shape: strokePath(`M ${i.x1} ${i.y1} L ${i.x2} ${i.y2}`, i.stroke, i.arrows), text: "" };
    }
    return { shape: "", text: "" };
  });
  const front = fronts.map((f) => f.shape + f.text).join("");
  // A connector's texts: halfway along it on the board's color, and by its
  // ends (smaller, quieter), as on screen. Each in a box wide enough to wrap
  // like the screen's (220px at most), placed by its anchor.
  const LW = 220;
  const LH = 160;
  const label = (x: number, y: number, justify: string, alignItems: string, text: string, marks: TextMark[], end: boolean) =>
    html(
      x,
      y,
      LW,
      LH,
      `justify-content:${justify};align-items:${alignItems}`,
      `<div style="max-width:${LW}px;padding:${end ? "0 2px" : "2px 8px"};font-size:${end ? 12 : 14}px;color:${end ? colors.muted : colors.ink};` +
        `background:${end ? "transparent" : colors.board};border-radius:4px;overflow-wrap:anywhere">${richHtml(text, marks, colors, options.plainLists)}</div>`,
    );
  const labels = connectors
    .map(({ item, points }) => {
      let out = "";
      if (item.text.trim()) {
        const mid = midpointOf(points);
        out += label(mid.x - LW / 2, mid.y - LH / 2, "center", "center", item.text, item.textMarks, false);
      }
      for (const [text, marks, run] of [
        [item.startText, item.startTextMarks, points],
        [item.endText, item.endTextMarks, [...points].reverse()],
      ] as const) {
        if (!text.trim()) continue;
        const place = endLabelPlace(run);
        out +=
          place.side === "above"
            ? label(place.x - LW / 2, place.y - LH, "center", "flex-end", text, marks, true)
            : label(place.x, place.y - LH / 2, "flex-start", "center", text, marks, true);
      }
      return out;
    })
    .join("");

  const font = options.font ?? FONT;
  const head =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${x0} ${y0} ${width} ${height}" font-family="${escapeXml(font)}">` +
    `<defs>` +
    arrowMarker("wb-arrow", ARROW_HEADS.normal, colors.line) +
    arrowMarker("wb-arrow-large", ARROW_HEADS.large, colors.line) +
    `<filter id="wb-shadow" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="2" stdDeviation="3" flood-opacity="0.12"/></filter>` +
    `</defs>`;
  const background = `<rect x="${x0}" y="${y0}" width="${width}" height="${height}" fill="${colors.board}"/>`;
  const group = (inner: string) => `<g style="font-family:${escapeXml(font)}">${inner}</g></svg>`;
  const slideBackground = options.background?.image
    ? `<image x="${x0}" y="${y0}" width="${width}" height="${height}" href="${escapeXml(options.background.image)}" preserveAspectRatio="xMidYMid slice"/>`
    : options.background?.color
      ? `<rect x="${x0}" y="${y0}" width="${width}" height="${height}" fill="${escapeXml(options.background.color)}"/>`
      : "";
  const svg = head + background + group(`${slideBackground}${connectorLines}${front}${labels}`);
  const layers = [{ shapes: slideBackground + connectorLines, text: "" }, ...fronts.map((f) => ({ shapes: f.shape, text: f.text })), { shapes: "", text: labels }];
  return { svg, width, height, layers, layerSvg: (inner) => head + group(inner) };
}
