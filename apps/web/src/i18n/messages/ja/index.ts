import type { MessageShape } from "../en";
import account from "./account";
import admin from "./admin";
import app from "./app";
import audit from "./audit";
import auth from "./auth";
import common from "./common";
import editor from "./editor";
import mail from "./mail";

// Japanese text (the keys are en's, checked by the type).
const ja: MessageShape = { ...common, ...auth, ...account, ...app, ...editor, ...admin, ...mail, ...audit };

export default ja;
