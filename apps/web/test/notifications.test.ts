import assert from "node:assert/strict";
import { describe, test } from "node:test";
import * as Y from "yjs";
import { docNotices } from "../src/lib/doc-notices";
import { parseNotificationPrefs, wantsNotification } from "../src/lib/notification-prefs";
import { isPushEndpoint, parsePushSubscription } from "../src/lib/push-endpoint";

// Notifications: where desktop notifications may be sent (the server sends a
// request to the address a browser gives), what is read from a page's
// document, and the stored settings.
//   pnpm --filter web test:unit

describe("push endpoints", () => {
  test("the browsers' push services are accepted", () => {
    for (const url of [
      "https://fcm.googleapis.com/fcm/send/abc:def",
      "https://updates.push.services.mozilla.com/wpush/v2/gAAAA",
      "https://web.push.apple.com/QGuQyavXutnMH",
      "https://wns2-par02p.notify.windows.com/w/?token=AwYAAA",
    ]) {
      assert.ok(isPushEndpoint(url), url);
    }
  });

  test("anything else isn't: other hosts, look-alikes, http, credentials, ports", () => {
    for (const url of [
      "https://example.com/push",
      "https://fcm.googleapis.com.evil.example/x",
      "https://evilfcm.googleapis.com/x",
      "https://push.apple.com.evil.example/x",
      "https://evilpush.apple.com/x",
      "http://fcm.googleapis.com/fcm/send/x",
      "https://user:pass@fcm.googleapis.com/x",
      "https://fcm.googleapis.com:8443/x",
      "https://127.0.0.1/x",
      "https://169.254.169.254/latest/meta-data",
      "javascript:alert(1)",
      "",
      42,
      null,
    ]) {
      assert.ok(!isPushEndpoint(url), String(url));
    }
  });

  test("a subscription needs both keys, in base64url", () => {
    const keys = { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" };
    assert.ok(parsePushSubscription({ endpoint: "https://fcm.googleapis.com/fcm/send/x", keys }));
    assert.equal(parsePushSubscription({ endpoint: "https://example.com/x", keys }), null);
    assert.equal(parsePushSubscription({ endpoint: "https://fcm.googleapis.com/fcm/send/x", keys: { p256dh: keys.p256dh } }), null);
    assert.equal(parsePushSubscription({ endpoint: "https://fcm.googleapis.com/fcm/send/x", keys: { ...keys, auth: "<script>" } }), null);
  });
});

// A document shaped as BlockNote stores one (blockContainer > content).
function docWith(build: (fragment: Y.XmlFragment) => void): Y.Doc {
  const doc = new Y.Doc();
  build(doc.getXmlFragment("blocknote"));
  return doc;
}

function block(id: string, content: Y.XmlElement): Y.XmlElement {
  const container = new Y.XmlElement("blockContainer");
  container.setAttribute("id", id);
  container.insert(0, [content]);
  return container;
}

describe("a page's TODOs and mentions", () => {
  test("TODOs with their assignee, date and state; mentions once each, with their block's text", () => {
    const doc = docWith((fragment) => {
      const group = new Y.XmlElement("blockGroup");
      fragment.insert(0, [group]);
      const todo = new Y.XmlElement("todo");
      todo.setAttribute("assignee", "user-1");
      todo.setAttribute("due", "2026-11-10");
      todo.setAttribute("checked", false as never);
      todo.insert(0, [new Y.XmlText("資料を送る")]);
      const paragraph = new Y.XmlElement("paragraph");
      const mention = new Y.XmlElement("mention");
      mention.setAttribute("userId", "user-2");
      const again = new Y.XmlElement("mention");
      again.setAttribute("userId", "user-2");
      paragraph.insert(0, [new Y.XmlText("確認お願いします "), mention, again]);
      const bad = new Y.XmlElement("todo");
      bad.setAttribute("assignee", "<script>");
      bad.setAttribute("due", "tomorrow");
      group.insert(0, [block("b1", todo), block("b2", paragraph), block("b3", bad)]);
    });
    const { todos, mentions } = docNotices(doc);
    assert.deepEqual(todos, [
      { blockId: "b1", assigneeId: "user-1", due: "2026-11-10", checked: false, text: "資料を送る" },
      { blockId: "b3", assigneeId: null, due: null, checked: false, text: "" },
    ]);
    assert.deepEqual(mentions, [{ userId: "user-2", text: "確認お願いします" }]);
  });
});

describe("notification settings", () => {
  test("missing or malformed values are the defaults", () => {
    assert.deepEqual(parseNotificationPrefs(null).kinds.MENTION, true);
    const prefs = parseNotificationPrefs({ kinds: { CHAT_MESSAGE: false, MENTION: "no", OTHER: false }, pushDetails: false });
    assert.equal(prefs.kinds.CHAT_MESSAGE, false);
    assert.equal(prefs.kinds.MENTION, true);
    assert.equal(prefs.pushDetails, false);
    assert.ok(!("OTHER" in prefs.kinds));
    assert.equal(prefs.enabled, true);
  });

  test("all off: nothing, whatever each kind says", () => {
    const off = parseNotificationPrefs({ enabled: false, kinds: { MENTION: true } });
    assert.equal(wantsNotification(off, "MENTION"), false);
    assert.equal(wantsNotification(parseNotificationPrefs(null), "MENTION"), true);
  });
});
