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
    passkeys: {
      heading: "パスキー",
      lead: "パスワードの代わりに、パスキー（指紋・顔・端末の PIN）でログインできます。パスワードでのログインもそのまま使えます。",
      leadRequired: "このサイトでは、ログインにパスキーが必要です（パスワードではログインできません）。使う端末ごとに登録するか、スマートフォンに保存してください。",
      none: "登録しているパスキーはありません。",
      name: "名前",
      namePlaceholder: "例: 仕事用のノートパソコン",
      defaultName: "パスキー",
      createdAt: "登録日時",
      lastUsedAt: "最後に使った日時",
      register: "パスキーを登録",
      registering: "登録しています…",
      remove: "削除",
      removeTitle: "パスキーを削除しますか？",
      removeConfirm: "パスキー「{name}」を削除しますか？ このパスキーではログインできなくなります。",
      removeFailed: "パスキーを削除できません",
      lastRequiredNote: "このサイトではパスキーが必要です。削除する前に、別のパスキーを登録してください。",
      unsupported: "このブラウザーではパスキーを使えません。",
      errors: {
        signedOut: "ログアウトされました。もう一度ログインしてください。",
        nameTooLong: "名前は {max, number} 文字以内にしてください。",
        expired: "登録の有効期限が切れました。もう一度お試しください。",
        invalid: "パスキーを登録できませんでした。もう一度お試しください。",
        notFound: "このパスキーは見つかりません。",
        lastRequired: "このサイトではパスキーが必要なため、最後の1つは削除できません。先に別のパスキーを登録してください。",
        alreadyRegistered: "この端末には、このアカウントのパスキーがすでにあります。",
        browser: "ブラウザーでパスキーを作れませんでした。もう一度お試しください。",
      },
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
