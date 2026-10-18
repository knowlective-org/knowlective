import type en from "../en/account";
import type { MessageShape } from "../en";

const ja: MessageShape<typeof en> = {
  account: {
    title: "アカウント",
    personalRootTitle: "マイページ",
    details: "登録内容",
    name: "名前",
    email: "メールアドレス",
    role: "ロール",
    language: {
      heading: "表示言語",
      label: "言語",
      browser: "ブラウザの設定に合わせる",
      note: "画面と、あなたに届くメールの言語です。",
    },
    passwordReset: {
      heading: "パスワードの再設定",
      ssoUnavailable: "このアカウントはシングルサインオンでログインするため、ここではパスワードを再設定できません。",
      mailUnavailable:
        "メール送信が設定されていないため、ここではパスワードを再設定できません。再設定が必要な場合は、管理者に連絡してください（管理者が再設定用のリンクを発行できます）。",
      explain: "{email} に、新しいパスワードを設定するためのリンクをメールで送ります。リンクを開くまで、今のパスワードは変わりません。",
      submit: "再設定用のリンクを送る",
      sent: "{email} に、再設定用のリンクをメールで送信しました（{duration}有効）。",
      sentNote: "メールのリンクから新しいパスワードを設定すると、ログイン中の画面はすべてログアウトされます。新しいパスワードでログインし直してください。",
    },
    errors: {
      ssoAccount: "シングルサインオンでログインするアカウントのため、パスワードは再設定できません。",
      tooMany: "再設定のメールを続けて送りすぎています。しばらく待ってからお試しください。",
      mailFailed: "メールを送信できませんでした。時間をおいて再度お試しいただくか、管理者に連絡してください。",
    },
  },
};

export default ja;
