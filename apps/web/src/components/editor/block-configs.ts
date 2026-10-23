// The configs (type, props, content) of knowlective's own blocks, shared by
// the editor (the React specs in *-block.tsx) and the server (lib/api/
// blocks-schema.ts, which reads and writes page documents without React).
// Keep dependency-free.
//
// Block types and props are saved in page documents: never remove or rename a
// type once released (pages using it would no longer load).

export const BLOCK_CONFIGS = {
  childPages: {
    type: "childPages",
    propSchema: {
      // Shown above the list; empty shows the placeholder title.
      title: { default: "" },
      depth: { default: 1 },
    },
    content: "none",
  },
  childTable: {
    type: "childTable",
    propSchema: {
      // Shown above the table; empty shows the placeholder title.
      title: { default: "" },
      // JSON array of column keys (built-in names or column ids) in display
      // order, the title column excluded (always first). Keys missing from it, e.g.
      // newly added columns, follow in their default order.
      order: { default: "" },
      // JSON array of column keys (built-in names or column ids). By default
      // the creation columns are hidden.
      hidden: { default: JSON.stringify(["createdAt", "createdBy"]) },
      // "<key>:asc" / "<key>:desc", or "" for creation order.
      sort: { default: "" },
    },
    content: "none",
  },
  childBoard: {
    type: "childBoard",
    propSchema: {
      // Shown above the board; empty shows the placeholder title.
      title: { default: "" },
      // Id of the select column the cards are grouped by. Empty (or a column
      // that no longer exists) uses the page's first select column.
      groupBy: { default: "" },
    },
    content: "none",
  },
  linkPreview: {
    type: "linkPreview",
    propSchema: {
      url: { default: "" },
      title: { default: "" },
      description: { default: "" },
      image: { default: "" },
      siteName: { default: "" },
    },
    content: "none",
  },
  mermaid: {
    type: "mermaid",
    propSchema: {
      code: { default: "" },
    },
    content: "none",
  },
  pdf: {
    type: "pdf",
    propSchema: {
      url: { default: "" },
      name: { default: "" },
    },
    content: "none",
  },
  videoEmbed: {
    type: "videoEmbed",
    propSchema: {
      url: { default: "" },
    },
    content: "none",
  },
} as const;

// Body headings start at H2: the page title is the page's one H1.
export const HEADING_LEVELS = [2, 3, 4, 5, 6] as const;
