import * as Y from "yjs";

// The blocks that show a page's child pages with their columns
// (PagePropertyDef): the table, the board and the calendar. The plain list
// (childPages) shows none. A child page shows its values under its title
// (loadPageProperties) only while its parent has one of these: columns made
// for a calendar since taken away, say, aren't the child pages' business.
export const CHILD_VIEW_BLOCKS = ["childTable", "childBoard", "childCalendar"] as const;

// Whether the page's document (as a Yjs update) has one of them, anywhere.
export function hasChildViewBlock(state: Uint8Array): boolean {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  const visit = (node: Y.XmlElement | Y.XmlFragment): boolean =>
    node.toArray().some(
      (child) =>
        child instanceof Y.XmlElement &&
        ((CHILD_VIEW_BLOCKS as readonly string[]).includes(child.nodeName) || visit(child)),
    );
  return visit(doc.getXmlFragment("blocknote"));
}
