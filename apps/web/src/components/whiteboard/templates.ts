import type { ItemColor, Route, SHAPE_TYPES } from "@/lib/whiteboard";

// Ready-made boards put in with the toolbar's "Templates": what they're made
// of, laid out from their top left at (0, 0). Their text is in the language
// of whoever puts them in (`t`); after that it's ordinary items.
// No dependencies but the types (unit tests: test/whiteboard-templates.test.ts).

export const TEMPLATES = ["kpt", "brainstorm", "orgChart", "matrix"] as const;
export type TemplateName = (typeof TEMPLATES)[number];

export type TemplateBox = {
  key: string;
  type: (typeof SHAPE_TYPES)[number];
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  color: ItemColor;
};
export type TemplateConnector = { from: string; to: string; route: Route; arrows: "end" | "none" };
export type Template = { boxes: TemplateBox[]; connectors: TemplateConnector[] };

// The texts a template needs, by key (whiteboard.templates.<name>.<key>).
type Translate = (key: string) => string;

export function buildTemplate(name: TemplateName, t: Translate): Template {
  switch (name) {
    case "kpt":
      return kpt(t);
    case "brainstorm":
      return brainstorm(t);
    case "orgChart":
      return orgChart(t);
    case "matrix":
      return matrix(t);
  }
}

const box = (key: string, type: TemplateBox["type"], x: number, y: number, w: number, h: number, text: string, color: ItemColor): TemplateBox => ({
  key,
  type,
  x,
  y,
  w,
  h,
  text,
  color,
});

// Keep / Problem / Try: three columns with a heading and a sticky note to
// start each (Try spans the right half, as usual).
function kpt(t: Translate): Template {
  const W = 300;
  const H = 520;
  return {
    boxes: [
      box("title", "text", 0, 0, 3 * W + 40, 36, t("kpt.title"), "white"),
      box("keep", "rect", 0, 48, W, H, "", "white"),
      box("problem", "rect", W + 20, 48, W, H, "", "white"),
      box("try", "rect", 2 * W + 40, 48, W, H, "", "white"),
      box("keepHead", "text", 12, 60, W - 24, 28, t("kpt.keep"), "white"),
      box("problemHead", "text", W + 32, 60, W - 24, 28, t("kpt.problem"), "white"),
      box("tryHead", "text", 2 * W + 52, 60, W - 24, 28, t("kpt.try"), "white"),
      box("keepNote", "sticky", 20, 110, 120, 100, t("kpt.keepNote"), "green"),
      box("problemNote", "sticky", W + 40, 110, 120, 100, t("kpt.problemNote"), "pink"),
      box("tryNote", "sticky", 2 * W + 60, 110, 120, 100, t("kpt.tryNote"), "blue"),
    ],
    connectors: [],
  };
}

// A topic in the middle and ideas around it, each connected to it.
function brainstorm(t: Translate): Template {
  const center = { x: 360, y: 260 };
  const ideas: TemplateBox[] = [];
  const connectors: TemplateConnector[] = [];
  const colors: ItemColor[] = ["yellow", "orange", "pink", "purple", "blue", "green"];
  for (let i = 0; i < 6; i++) {
    const angle = -Math.PI / 2 + (i * Math.PI) / 3;
    const x = Math.round(center.x + 280 * Math.cos(angle) - 55);
    const y = Math.round(center.y + 200 * Math.sin(angle) - 50);
    ideas.push(box(`idea${i}`, "sticky", x, y, 110, 100, t("brainstorm.idea"), colors[i]));
    connectors.push({ from: "topic", to: `idea${i}`, route: "straight", arrows: "none" });
  }
  return {
    boxes: [box("topic", "ellipse", center.x - 100, center.y - 50, 200, 100, t("brainstorm.topic"), "yellow"), ...ideas],
    connectors,
  };
}

// One at the top, three under it, two under each of those: joined by
// right-angle connectors.
function orgChart(t: Translate): Template {
  const W = 150;
  const H = 60;
  const boxes: TemplateBox[] = [box("head", "rect", 375, 0, W, H, t("orgChart.head"), "blue")];
  const connectors: TemplateConnector[] = [];
  for (let i = 0; i < 3; i++) {
    const x = i * 300 + 75;
    boxes.push(box(`unit${i}`, "rect", x, 140, W, H, t("orgChart.unit"), "white"));
    connectors.push({ from: "head", to: `unit${i}`, route: "elbow", arrows: "none" });
    for (let j = 0; j < 2; j++) {
      boxes.push(box(`member${i}${j}`, "rect", x - 80 + j * 160, 280, W - 10, H - 10, t("orgChart.member"), "white"));
      connectors.push({ from: `unit${i}`, to: `member${i}${j}`, route: "elbow", arrows: "none" });
    }
  }
  return { boxes, connectors };
}

// Two axes, four quarters (important × urgent, by default).
function matrix(t: Translate): Template {
  const S = 300;
  const colors: ItemColor[] = ["pink", "orange", "blue", "gray"];
  const quarters = (["q1", "q2", "q3", "q4"] as const).map((key, i) =>
    box(key, "rect", 40 + (i % 2) * (S + 10), 40 + Math.floor(i / 2) * (S + 10), S, S, t(`matrix.${key}`), colors[i]),
  );
  return {
    boxes: [
      box("yAxis", "text", -160, 40 + S - 14, 190, 28, t("matrix.yAxis"), "white"),
      box("xAxis", "text", 40, 40 + 2 * S + 20, 2 * S + 10, 28, t("matrix.xAxis"), "white"),
      ...quarters,
    ],
    connectors: [],
  };
}

// The rectangle a template takes up.
export function templateBounds(template: Template): { x: number; y: number; w: number; h: number } {
  const xs = template.boxes.flatMap((b) => [b.x, b.x + b.w]);
  const ys = template.boxes.flatMap((b) => [b.y, b.y + b.h]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}
