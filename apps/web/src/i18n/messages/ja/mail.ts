import type en from "../en/mail";
import type { MessageShape } from "../en";

const ja: MessageShape<typeof en> = {
  mail: {
    invitation: {
      subject: "KNOWLECTIVE への招待",
      invitedBy: "{inviter} から、KNOWLECTIVE に{role}として招待されました。",
      administrator: "KNOWLECTIVE の管理者",
      role: {
        SITE_ADMIN: "サイト管理者",
        CONTENT_MANAGER: "コンテンツ管理者",
        USER: "一般ユーザー",
      },
      groups: "登録すると、次のグループに参加します: {groups}",
      open: "次のリンクを開いて、アカウントを登録してください。",
      expires: "このリンクは{duration}有効で、1回だけ使えます。",
      ignore: "心当たりがない場合は、このメールを無視してください。",
    },
    signup: {
      subject: "KNOWLECTIVE アカウント登録のご案内",
      received: "KNOWLECTIVE のアカウント登録を受け付けました。",
      open: "次のリンクを開いて、表示名とパスワードを設定してください。",
      expires: "このリンクは{duration}有効で、1回だけ使えます。",
      ignore: "心当たりがない場合は、このメールを無視してください（アカウントは作られません）。",
    },
    alreadyRegistered: {
      subject: "KNOWLECTIVE アカウント登録について",
      exists: "このメールアドレスで KNOWLECTIVE のアカウント登録が申し込まれましたが、すでにアカウントがあります。",
      login: "次のリンクからログインしてください。",
      forgot: "パスワードがわからない場合は、ログイン画面の「{forgotLink}」から再設定できます。",
      ignore: "心当たりがない場合は、このメールを無視してください。",
    },
    passwordReset: {
      subject: "KNOWLECTIVE パスワードの再設定",
      requested: "KNOWLECTIVE のパスワードの再設定を受け付けました。",
      issuedByAdmin: "管理者が、KNOWLECTIVE のパスワード再設定用のリンクを発行しました。",
      open: "次のリンクを開いて、新しいパスワードを設定してください。",
      expires: "このリンクは{duration}有効で、1回だけ使えます。再設定すると、ログイン中の端末はすべてログアウトします。",
      ignore: "心当たりがない場合は、このメールを無視してください（パスワードは変わりません）。",
    },
    test: {
      subject: "KNOWLECTIVE テストメール",
      body: "KNOWLECTIVE の管理画面から送信したテストメールです。",
      works: "このメールが届いていれば、メール送信の設定は正しく動いています。",
    },
  },
};

export default ja;
