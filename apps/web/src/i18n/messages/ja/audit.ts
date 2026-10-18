import type en from "../en/audit";
import type { MessageShape } from "../en";

const ja: MessageShape<typeof en> = {
  audit: {
    passwordReset: "{who} がパスワードを再設定（{via, select, admin {管理者が発行したリンク} other {メールのリンク}}）",
    oidcUserCreated: "シングルサインオンで {email} のアカウントを作成（{role}）",
  },
};

export default ja;
