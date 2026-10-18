import account from "./account";
import audit from "./audit";
import auth from "./auth";
import common from "./common";
import mail from "./mail";

// English text, by area: the source of truth for the message keys (every
// other language must have the same ones; see MessageShape). ICU message
// syntax: {name}, {count, plural, ...}, {x, select, ...}, <link>…</link>.

const en = { ...common, ...auth, ...account, ...mail, ...audit };

export default en;
export type Messages = typeof en;

// The same keys with any text: the shape every other language must have.
export type MessageShape<T = Messages> = { -readonly [K in keyof T]: T[K] extends string ? string : MessageShape<T[K]> };
