import * as Y from "yjs";
import { isLinkedView, linkedSource } from "./linked-views";

// The blocks that show a page's child pages with their columns
// (PagePropertyDef): the table, the board and the calendar. The plain list
// (childPages) shows none. A child page shows its values under its title
// (loadPageProperties) only while its parent has one of these: columns made
// for a calendar since taken away, say, aren't the child pages' business.
// Linked views (lib/linked-views.ts) show another page's child pages: they
// count for that page (PageLinkedView), not for the one they're on.
export const CHILD_VIEW_BLOCKS = ["childTable", "childBoard", "childCalendar"] as const;

function childViewNodes(doc: Y.Doc): Y.XmlElement[] {
  const found: Y.XmlElement[] = [];
  const visit = (node: Y.XmlElement | Y.XmlFragment) => {
    for (const child of node.toArray()) {
      if (!(child instanceof Y.XmlElement)) continue;
      if ((CHILD_VIEW_BLOCKS as readonly string[]).includes(child.nodeName)) found.push(child);
      else visit(child);
    }
  };
  visit(doc.getXmlFragment("blocknote"));
  return found;
}

// Whether the page's document (as a Yjs update) has one of them showing its
// own child pages, anywhere.
export function hasChildViewBlock(state: Uint8Array): boolean {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  return childViewNodes(doc).some((node) => !isLinkedView(node.getAttribute("source")));
}

// The pages the document's linked views show the child pages of (each once).
export function linkedViewSources(doc: Y.Doc): string[] {
  const ids = new Set<string>();
  for (const node of childViewNodes(doc)) {
    const id = linkedSource(node.getAttribute("source"));
    if (id) ids.add(id);
  }
  return [...ids];
}
