import type { MessageShape } from "../en";
import account from "./account";
import audit from "./audit";
import auth from "./auth";
import common from "./common";
import mail from "./mail";

// Japanese text (the keys are en's, checked by the type).
const ja: MessageShape = { ...common, ...auth, ...account, ...mail, ...audit };

export default ja;
