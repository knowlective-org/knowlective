import * as Y from "yjs";

// What in a page's document can lead to a notification: its TODO blocks
// (assignee, due date, done) and its mentions (@name), as stored. Read by the
// notifier on every store (server/notifications.ts), which compares them with
// the last ones to notify a new assignee or a new mention.

export type DocTodo = { blockId: string; assigneeId: string | null; due: string | null; checked: boolean; text: string };
// One per person mentioned: the text of the first block mentioning them.
export type DocMention = { userId: string; text: string };

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TEXT = 200;

// The text of a block's content (its own, not its children's).
function textOf(element: Y.XmlElement): string {
  let text = "";
  const visit = (node: Y.XmlElement | Y.XmlText) => {
    if (node instanceof Y.XmlText) {
      for (const op of node.toDelta() as { insert: unknown }[]) if (typeof op.insert === "string") text += op.insert;
    } else {
      for (const child of node.toArray()) visit(child as Y.XmlElement | Y.XmlText);
    }
  };
  visit(element);
  return text.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
}

export function docNotices(doc: Y.Doc): { todos: DocTodo[]; mentions: DocMention[] } {
  const todos: DocTodo[] = [];
  const mentions = new Map<string, string>();
  const visit = (node: Y.XmlElement | Y.XmlText | Y.XmlFragment, blockId: string | null, block: Y.XmlElement | null) => {
    if (node instanceof Y.XmlText) return;
    if (node instanceof Y.XmlElement) {
      if (node.nodeName === "blockContainer") {
        const id = node.getAttribute("id");
        blockId = typeof id === "string" ? id : null;
      } else if (node.nodeName === "todo" && blockId && ID.test(blockId)) {
        const assignee = node.getAttribute("assignee") as unknown;
        const due = node.getAttribute("due") as unknown;
        const checked = node.getAttribute("checked") as unknown;
        todos.push({
          blockId,
          assigneeId: typeof assignee === "string" && ID.test(assignee) ? assignee : null,
          due: typeof due === "string" && DATE.test(due) ? due : null,
          checked: checked === true || checked === "true",
          text: textOf(node),
        });
      } else if (node.nodeName === "mention") {
        const userId = node.getAttribute("userId") as unknown;
        if (typeof userId === "string" && ID.test(userId) && !mentions.has(userId)) {
          mentions.set(userId, block ? textOf(block) : "");
        }
        return;
      }
      // The block's content element: what a mention's excerpt is taken from.
      if (node.nodeName !== "blockContainer" && node.nodeName !== "blockGroup") block = node;
    }
    for (const child of node.toArray()) visit(child as Y.XmlElement | Y.XmlText, blockId, block);
  };
  visit(doc.getXmlFragment("blocknote"), null, null);
  return { todos, mentions: [...mentions].map(([userId, text]) => ({ userId, text })) };
}
