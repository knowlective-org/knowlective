import type { CSSProperties } from "react";

// The whiteboard's icons: one set, drawn on a 20 × 20 grid with 1.6 wide
// round strokes in the text color (so they follow the theme and the
// buttons' state). Each is one or more paths; `w` changes a path's width,
// `dash` dashes it and `fill` fills it.

type IconPath = { d: string; w?: number; dash?: string; fill?: boolean };

const ICONS = {
  // Tools
  select: [{ d: "M5 3.5 15.5 9.6 10.7 10.9 8.4 15.8Z" }],
  hand: [
    {
      d: "M7 10.5V5a1.3 1.3 0 0 1 2.6 0v4.5M9.6 9V3.8a1.3 1.3 0 0 1 2.6 0V9M12.2 9V5.3a1.3 1.3 0 0 1 2.6 0v6.2c0 3.2-2.2 5.5-5.3 5.5h-.4c-1.9 0-3.1-.8-4.2-2.3L3.4 11.9a1.3 1.3 0 0 1 2.1-1.5L7 12",
    },
  ],
  sticky: [{ d: "M4 3.5h12v8.5l-4.5 4.5H4ZM16 12h-4.5v4.5" }],
  rect: [{ d: "M4.5 5h11A1.5 1.5 0 0 1 17 6.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 13.5v-7A1.5 1.5 0 0 1 4.5 5Z" }],
  ellipse: [{ d: "M2.5 10a7.5 5.5 0 1 0 15 0 7.5 5.5 0 1 0-15 0" }],
  diamond: [{ d: "M10 2.5 17.5 10 10 17.5 2.5 10Z" }],
  text: [{ d: "M4.5 5.5V4h11v1.5M10 4v12M7.5 16h5" }],
  line: [{ d: "M4.5 15.5 15.5 4.5" }, { d: "M4.5 15.5h.01M15.5 4.5h.01", w: 3.4 }],
  connector: [{ d: "M2.5 12.5h5v5h-5ZM12.5 2.5h5v5h-5ZM7.5 12.5l5-5" }],
  image: [{ d: "M4 4h12a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1ZM3 13.5l4-4 3.5 3.5 2.5-2.5 4 4M12 8a1.3 1.3 0 1 0 2.6 0 1.3 1.3 0 1 0-2.6 0" }],
  templates: [{ d: "M3.5 3.5h5v5h-5ZM11.5 3.5h5v5h-5ZM3.5 11.5h5v5h-5ZM11.5 11.5h5v5h-5Z" }],

  // Text
  bulletList: [{ d: "M8 5.5h9M8 10h9M8 14.5h9" }, { d: "M4 5.5h.01M4 10h.01M4 14.5h.01", w: 2.8 }],
  numberedList: [{ d: "M8.5 5.5H17M8.5 10H17M8.5 14.5H17M3.5 4.5l1.2-1v4.3M3.2 12.3a1.1 1.1 0 0 1 2.1.4c0 1-2.1 1.4-2.1 2.6h2.2" }],
  resetText: [{ d: "M7 5.5 4 8.5l3 3M4 8.5h8.5a3.5 3.5 0 0 1 0 7H9" }],

  // Lining up
  alignLeft: [{ d: "M3 2.5v15M6 5h10v3.5H6ZM6 11.5h6V15H6Z" }],
  alignCenterX: [{ d: "M10 2.5v2.5M10 8.5v3M10 15v2.5M4 5h12v3.5H4ZM6.5 11.5h7V15h-7Z" }],
  alignRight: [{ d: "M17 2.5v15M4 5h10v3.5H4ZM8 11.5h6V15H8Z" }],
  alignTop: [{ d: "M2.5 3h15M5 6h3.5v10H5ZM11.5 6H15v6h-3.5Z" }],
  alignCenterY: [{ d: "M2.5 10H5M8.5 10h3M15 10h2.5M5 4h3.5v12H5ZM11.5 6.5H15v7h-3.5Z" }],
  alignBottom: [{ d: "M2.5 17h15M5 4h3.5v10H5ZM11.5 8H15v6h-3.5Z" }],
  distributeX: [{ d: "M3 3v14M17 3v14M7.5 6h5v8h-5Z" }],
  distributeY: [{ d: "M3 3h14M3 17h14M6 7.5h8v5H6Z" }],

  // Links
  link: [{ d: "M8.6 11.4a3 3 0 0 0 4.2 0l2.7-2.7a3 3 0 0 0-4.2-4.2l-1 1M11.4 8.6a3 3 0 0 0-4.2 0l-2.7 2.7a3 3 0 0 0 4.2 4.2l1-1" }],
  unlink: [{ d: "M13 11.2l2.5-2.5a3 3 0 0 0-4.2-4.2l-1 1M7 8.8l-2.5 2.5a3 3 0 0 0 4.2 4.2l1-1M3.5 3.5l13 13" }],

  // Lines: arrowheads, routes and strokes
  arrowEnd: [{ d: "M3 10h13M12 6l4 4-4 4" }],
  arrowBoth: [{ d: "M3.5 10h13M7.5 6l-4 4 4 4M12.5 6l4 4-4 4" }],
  arrowStart: [{ d: "M4 10h13M8 6l-4 4 4 4" }],
  arrowNone: [{ d: "M5 10h10" }, { d: "M4 10h.01M16 10h.01", w: 3.4 }],
  routeStraight: [{ d: "M4 16 16 4" }],
  routeElbow: [{ d: "M4 16V7a2.5 2.5 0 0 1 2.5-2.5H16" }],
  strokeSolid: [{ d: "M3 10h14" }],
  strokeBold: [{ d: "M3.5 10h13", w: 3.8 }],
  strokeDashed: [{ d: "M3 10h3M8.5 10h3M14 10h3" }],
  strokeDouble: [{ d: "M3 7.8h14M3 12.2h14" }],
  endsSpread: [{ d: "M3 16.5h14" }, { d: "M5 3.5 6.5 14M10 3.5V14M15 3.5 13.5 14" }],
  endsMerge: [{ d: "M3 16.5h14" }, { d: "M4 3.5 10 14M10 3.5V14M16 3.5 10 14" }],

  // Arranging
  bringToFront: [{ d: "M3.5 13.5 10 17l6.5-3.5" }, { d: "M10 13V3.5M6.5 7 10 3.5 13.5 7" }],
  sendToBack: [{ d: "M3.5 13.5 10 17l6.5-3.5" }, { d: "M10 3.5V13M6.5 9.5 10 13l3.5-3.5" }],
  duplicate: [{ d: "M7.5 7.5h9v9h-9ZM12.5 7.5v-4h-9v9h4" }],
  delete: [{ d: "M3.5 5.5h13M8 5.5v-2h4v2M5.2 5.5l.8 11h8l.8-11M8.5 8.5v5M11.5 8.5v5" }],

  // The view
  zoomIn: [{ d: "M4 10h12M10 4v12" }],
  zoomOut: [{ d: "M4 10h12" }],
  fit: [{ d: "M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4M7.5 7.5h5v5h-5Z" }],
  grid: [{ d: "M5 5h.01M10 5h.01M15 5h.01M5 10h.01M10 10h.01M15 10h.01M5 15h.01M10 15h.01M15 15h.01", w: 2.6 }],
  fullscreen: [{ d: "M3 7.5V3h4.5M3 3l4.5 4.5M17 7.5V3h-4.5M17 3l-4.5 4.5M3 12.5V17h4.5M3 17l4.5-4.5M17 12.5V17h-4.5M17 17l-4.5-4.5" }],
  exitFullscreen: [{ d: "M7.5 3v4.5H3M7.5 7.5 3 3M12.5 3v4.5H17M12.5 7.5 17 3M7.5 17v-4.5H3M7.5 12.5 3 17M12.5 17v-4.5H17M12.5 12.5 17 17" }],
} satisfies Record<string, IconPath[]>;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 20, className, style }: { name: IconName; size?: number | string; className?: string; style?: CSSProperties }) {
  return (
    <svg
      viewBox="0 0 20 20"
      width={size}
      height={size}
      aria-hidden
      focusable="false"
      className={className}
      style={{ display: "block", margin: "auto", flex: "none", ...style }}
      data-icon={name}
    >
      {(ICONS[name] as IconPath[]).map((p, i) => (
        <path
          key={i}
          d={p.d}
          fill={p.fill ? "currentColor" : "none"}
          fillOpacity={p.fill ? 0.3 : undefined}
          stroke="currentColor"
          strokeWidth={p.w ?? 1.6}
          strokeDasharray={p.dash}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}
