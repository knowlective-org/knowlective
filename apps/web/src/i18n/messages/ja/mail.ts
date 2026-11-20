import type en from "../en/mail";
import type { MessageShape } from "../en";

const ja: MessageShape<typeof en> = {
  mail: {
    invitation: {
      subject: "knowlective への招待",
      invitedBy: "{inviter} から、knowlective に{role}として招待されました。",
      administrator: "knowlective の管理者",
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
      subject: "knowlective アカウント登録のご案内",
      received: "knowlective のアカウント登録を受け付けました。",
      open: "次のリンクを開いて、表示名とパスワードを設定してください。",
      expires: "このリンクは{duration}有効で、1回だけ使えます。",
      ignore: "心当たりがない場合は、このメールを無視してください（アカウントは作られません）。",
    },
    alreadyRegistered: {
      subject: "knowlective アカウント登録について",
      exists: "このメールアドレスで knowlective のアカウント登録が申し込まれましたが、すでにアカウントがあります。",
      login: "次のリンクからログインしてください。",
      forgot: "パスワードがわからない場合は、ログイン画面の「{forgotLink}」から再設定できます。",
      ignore: "心当たりがない場合は、このメールを無視してください。",
    },
    passwordReset: {
      subject: "knowlective パスワードの再設定",
      requested: "knowlective のパスワードの再設定を受け付けました。",
      issuedByAdmin: "管理者が、knowlective のパスワード再設定用のリンクを発行しました。",
      open: "次のリンクを開いて、新しいパスワードを設定してください。",
      expires: "このリンクは{duration}有効で、1回だけ使えます。再設定すると、ログイン中の端末はすべてログアウトします。",
      ignore: "心当たりがない場合は、このメールを無視してください（パスワードは変わりません）。",
    },
    emailChange: {
      subject: "knowlective の新しいメールアドレスの確認",
      intro: "このアドレスを knowlective のアカウントのメールアドレスにする依頼がありました。",
      open: "ご本人であれば、次のリンクを開いて変更を確定してください。",
      expires: "リンクは1回だけ使え、{duration}で使えなくなります。",
      inUse: "このアドレスはほかの knowlective のアカウントで使われているため、使えません。何も変更していません。",
      ignore: "心当たりがない場合は、このメールは無視してください。",
    },
    adminEmailChange: {
      subject: "knowlective の確認コード: {code}",
      intro: "管理者が、あなたの knowlective のアカウントのメールアドレスを、このアドレスに変更するよう依頼しました。確定するには、次のコードを入力してください。",
      where: "knowlective に（今のメールアドレスで）ログインし、「アカウント」で入力します。",
      expires: "コードは1回だけ使え、{duration}で使えなくなります。入力するまで、メールアドレスは変わりません。",
      ignore: "心当たりがない場合は、このメールは無視してください（何も変わりません）。",
    },
    emailChanged: {
      subject: "knowlective のメールアドレスが変更されました",
      body: "knowlective のアカウントのメールアドレスが {email} に変更されました。これからのメールはそちらに届きます。",
      notYou: "心当たりがない場合は、すぐに管理者に連絡してください。",
    },
    emailCode: {
      subject: "knowlective の確認コード: {code}",
      intro: "API キーを発行するための本人確認です。knowlective の画面で次のコードを入力してください。",
      expires: "コードは1回だけ使え、{duration}で使えなくなります。",
      ignore: "心当たりがない場合は、誰かがあなたのアカウントにログインしている可能性があります。パスワードを変更し、管理者に連絡してください。",
    },
    test: {
      subject: "knowlective テストメール",
      body: "knowlective の管理画面から送信したテストメールです。",
      works: "このメールが届いていれば、メール送信の設定は正しく動いています。",
    },
  },
};

export default ja;
