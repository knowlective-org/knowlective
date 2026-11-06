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
      // Id of a select or user column splitting the cards into one board per
      // value (sub-groups), each with the same lanes. Empty: one board.
      subGroupBy: { default: "" },
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
  chat: {
    type: "chat",
    // The messages are rows on the server, keyed by the block's id
    // (lib/chat.ts): nothing about them is in the document.
    propSchema: {},
    content: "none",
  },
  maskedText: {
    type: "maskedText",
    propSchema: {
      // The text sealed with a passphrase in the browser (lib/secret-text.ts);
      // "" until something is locked in it. Never the plain text.
      sealed: { default: "" },
    },
    content: "none",
  },
  // A to-do item (the slash menu's TODO, in place of BlockNote's check list).
  todo: {
    type: "todo",
    propSchema: {
      checked: { default: false },
      // A user id, "" for nobody. Names come from the server, for those who
      // can open the page (people-actions.ts).
      assignee: { default: "" },
      // YYYY-MM-DD, "" for none.
      due: { default: "" },
      // Who ticked it (a user id) and when (ISO), "" while it isn't done.
      // Written by the ticking person's browser: like the rest of the
      // document, anyone who can edit the page could change them.
      doneBy: { default: "" },
      doneAt: { default: "" },
    },
    content: "inline",
  },
} as const;

// Props added to BlockNote's code block (its type and `language` stay
// BlockNote's). `preview`: "" none, "below" the result under the code, "only"
// the result in place of the code (code-preview.ts; for the languages it can
// show).
export const CODE_BLOCK_EXTRA_PROPS = {
  preview: { default: "" },
} as const;

// Body headings start at H2: the page title is the page's one H1.
export const HEADING_LEVELS = [2, 3, 4, 5, 6] as const;

// knowlective's own inline content (inside a block's text), shared the same way.
export const INLINE_CONFIGS = {
  // A mention (@name): the person's user id; their name is shown from the
  // page's people (page-people.ts). Mentioning notifies them
  // (server/notifications.ts).
  mention: {
    type: "mention",
    propSchema: {
      userId: { default: "" },
    },
    content: "none",
  },
} as const;
