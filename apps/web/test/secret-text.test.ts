import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { SecretKeyring, WrongPassphraseError, openText, parseSealed, sealText } from "../src/lib/secret-text";

// Text locked with a passphrase, for the masked block (lib/secret-text.ts).
// The sealed string comes from the shared document, so anyone who can edit
// the page can write it.
//   pnpm --filter web test:unit

// Fewer rounds than the real default, to keep the tests quick.
const ITERATIONS = 100_000;

describe("text locked with a passphrase", () => {
  test("opens with the passphrase it was sealed with", async () => {
    const sealed = await sealText("口座番号 1234-5678\n2行目", "合言葉 correct horse", ITERATIONS);
    assert.equal(await openText(sealed, "合言葉 correct horse"), "口座番号 1234-5678\n2行目");
  });

  test("the sealed string holds no plain text, and differs every time", async () => {
    const a = await sealText("secret value", "pw", ITERATIONS);
    const b = await sealText("secret value", "pw", ITERATIONS);
    assert.ok(!a.includes("secret"));
    assert.notEqual(a, b);
  });

  test("a wrong passphrase, or an altered ciphertext, doesn't open it", async () => {
    const sealed = await sealText("secret", "right", ITERATIONS);
    await assert.rejects(openText(sealed, "wrong"), WrongPassphraseError);
    const parts = sealed.split(".");
    const data = parts[4];
    parts[4] = (data[0] === "A" ? "B" : "A") + data.slice(1);
    await assert.rejects(openText(parts.join("."), "right"), WrongPassphraseError);
  });

  test("malformed or weakened sealed strings are refused", async () => {
    const sealed = await sealText("secret", "pw", ITERATIONS);
    const [, , salt, iv, data] = sealed.split(".");
    assert.ok(parseSealed(sealed));
    assert.equal(parseSealed(""), null);
    assert.equal(parseSealed("v2.100000." + [salt, iv, data].join(".")), null);
    // Too few rounds would make guessing the passphrase cheap.
    assert.equal(parseSealed(["v1", "1", salt, iv, data].join(".")), null);
    assert.equal(parseSealed(["v1", "99999999", salt, iv, data].join(".")), null);
    assert.equal(parseSealed(["v1", "100000", "AAAA", iv, data].join(".")), null);
    assert.equal(parseSealed(["v1", "100000", salt, iv, "a+b/"].join(".")), null);
    assert.equal(parseSealed(sealed + ".extra"), null);
    await assert.rejects(openText("<script>", "pw"), /not a sealed text/);
  });
});

// A masked column's values (SecretKeyring): one key for the column.
describe("many texts under one passphrase", () => {
  test("opens texts sealed either way, and seals with the salt it already has", async () => {
    const existing = await sealText("first", "pw", ITERATIONS);
    const ring = new SecretKeyring("pw");
    assert.equal(await ring.open(existing), "first");
    const next = await ring.seal("second");
    assert.equal(next.split(".")[2], existing.split(".")[2]);
    assert.notEqual(next.split(".")[3], (await ring.seal("second")).split(".")[3]);
    assert.equal(await openText(next, "pw"), "second");
  });

  test("a keyring with another passphrase doesn't open them", async () => {
    const sealed = await new SecretKeyring("right").seal("secret");
    await assert.rejects(new SecretKeyring("wrong").open(sealed), WrongPassphraseError);
  });
});
