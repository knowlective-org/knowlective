import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { schemaOutline } from "../server/markdown-engine.mjs";
import { COLLAB_CLIENT_VERSION } from "../src/lib/collab-version";

// The page document's schema, as of COLLAB_CLIENT_VERSION. An editor that
// doesn't know a block type drops it from the shared document, so a change
// here must come with a new version (and old screens are refused,
// lib/collab-version.ts): when this fails, bump COLLAB_CLIENT_VERSION and
// record the new outline and version below.
//   pnpm --filter web test:unit

const RECORDED_VERSION = 6;
const RECORDED = [
  "mark backgroundColor(stringValue)",
  "mark bold()",
  "mark code()",
  "mark italic()",
  "mark link(href)",
  "mark strike()",
  "mark textColor(stringValue)",
  "mark underline()",
  "node audio(backgroundColor,caption,name,showPreview,url)",
  "node blockContainer(id)",
  "node blockGroup()",
  "node bulletListItem(backgroundColor,textAlignment,textColor)",
  "node chat(title)",
  "node checkListItem(backgroundColor,checked,textAlignment,textColor)",
  "node childBoard(groupBy,subGroupBy,title)",
  "node childPages(depth,title)",
  "node childTable(hidden,order,sort,title)",
  "node codeBlock(language,preview)",
  "node column(id,width)",
  "node columnList(id)",
  "node divider()",
  "node doc()",
  "node file(backgroundColor,caption,name,url)",
  "node gridCell(id)",
  "node gridRow(id)",
  "node gridTable(headerColumn,headerRow,id,widths)",
  "node hardBreak()",
  "node heading(backgroundColor,isToggleable,level,textAlignment,textColor)",
  "node image(backgroundColor,caption,name,previewWidth,showPreview,textAlignment,url)",
  "node linkPreview(description,image,siteName,title,url)",
  "node maskedText(sealed)",
  "node mention(userId)",
  "node mermaid(code)",
  "node numberedListItem(backgroundColor,start,textAlignment,textColor)",
  "node paragraph(backgroundColor,textAlignment,textColor)",
  "node pdf(name,url)",
  "node quote(backgroundColor,textColor)",
  "node table(textColor)",
  "node tableCell(backgroundColor,colspan,colwidth,rowspan,textAlignment,textColor)",
  "node tableHeader(backgroundColor,colspan,colwidth,rowspan,textAlignment,textColor)",
  "node tableParagraph()",
  "node tableRow()",
  "node text()",
  "node toc()",
  "node todo(assignee,checked,doneAt,doneBy,due)",
  "node toggleListItem(backgroundColor,textAlignment,textColor)",
  "node video(backgroundColor,caption,name,previewWidth,showPreview,textAlignment,url)",
  "node videoEmbed(url)",
  "node whiteboard(pageId)",
].join("\n");

describe("collab client version", () => {
  test("the document's schema is the one recorded for this version", () => {
    const outline = schemaOutline();
    if (COLLAB_CLIENT_VERSION !== RECORDED_VERSION) {
      assert.fail(`COLLAB_CLIENT_VERSION is ${COLLAB_CLIENT_VERSION}: record that version and its outline here:\n${outline}`);
    }
    assert.equal(outline, RECORDED, "The schema changed: bump COLLAB_CLIENT_VERSION (lib/collab-version.ts), then record the new outline here.");
  });
});
