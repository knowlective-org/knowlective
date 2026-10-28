import * as Y from "yjs";
import { currentPageState } from "@/lib/api/page-content";
import { TITLE_FIELD } from "@/lib/page-title";

// What someone not logged in gets of a public page: a copy of its document as
// it is now (base64), rendered read-only in the browser without connecting to
// collaborative editing — so no cursors or names go either way, and visitors
// don't hold a live document on the server. Only the current title and body
// are copied into a fresh document: the page's own Yjs state can still carry
// deleted content and edit history. Access is checked by the caller.
export async function publicPageState(pageId: string, storedTitle: string): Promise<string> {
  const state = await currentPageState(pageId);
  const source = new Y.Doc();
  if (state) Y.applyUpdate(source, state);
  const copy = new Y.Doc();
  copy.transact(() => {
    const body = source
      .getXmlFragment("blocknote")
      .toArray()
      .map((node) => (node as Y.XmlElement | Y.XmlText).clone());
    copy.getXmlFragment("blocknote").insert(0, body);
    // A page never opened has no document yet: the stored title.
    copy.getText(TITLE_FIELD).insert(0, state ? source.getText(TITLE_FIELD).toString() : storedTitle);
  });
  return Buffer.from(Y.encodeStateAsUpdate(copy)).toString("base64");
}
