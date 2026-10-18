import type en from "../en/common";
import type { MessageShape } from "../en";

const ja: MessageShape<typeof en> = {
  meta: {
    description: "セルフホスト可能なドキュメント・ナレッジ共有ツール",
    titleSuffix: "{title} | KNOWLECTIVE",
  },
  duration: {
    minute: "{count}分",
    hour: "{count}時間",
    day: "{count}日",
  },
  roles: {
    SITE_ADMIN: "サイト管理者",
    CONTENT_MANAGER: "コンテンツ管理者",
    USER: "一般ユーザー",
  },
  builtInGroups: {
    all_users: "全ユーザー",
    public: "インターネットに公開",
  },
  access: {
    VIEW: "閲覧",
    EDIT: "編集",
    MANAGE: "管理",
  },
  common: {
    email: "メールアドレス",
    password: "パスワード",
    passwordWithMin: "パスワード（{min, number}文字以上）",
    confirmPassword: "パスワード（確認）",
    displayName: "表示名",
    save: "保存",
    saving: "保存しています…",
    saved: "保存しました。",
    cancel: "キャンセル",
    close: "閉じる",
    delete: "削除",
    sending: "送信しています…",
    none: "なし",
    untitled: "無題",
    listSeparator: "、",
    sentenceSeparator: "",
    errors: {
      invalidInput: "入力内容が不正です。",
      emailFormat: "メールアドレスの形式が正しくありません。",
      passwordLength: "パスワードは{min, number}文字以上にしてください。",
      passwordMismatch: "確認用のパスワードが一致しません。",
      mailFailed: "メールを送信できませんでした。時間をおいてから、もう一度お試しください。",
      mailNotConfigured: "メール送信が設定されていないため、再設定のメールを送れません。管理者に連絡してください。",
      ssoOnly: "パスワードでのログインは無効になっています。シングルサインオンでログインしてください。",
      disabledAccount: "このアカウントは無効になっています。管理者に問い合わせてください。",
      signupClosed: "現在、アカウント登録は受け付けていません。",
      domainNotAllowed: "登録できるのは、次のドメインのメールアドレスだけです: {domains}",
    },
    spamNote: "メールが届かない場合は、迷惑メールのフォルダも確認してください。",
  },
  publicUrl: {
    format: "URL の形式が正しくありません（例: https://knowlective.example.com）。",
    scheme: "http:// または https:// で始まる URL を入力してください。",
    credentials: "URL にユーザー名やパスワードは含められません。",
    path: "パスやクエリを含まない URL を入力してください（例: https://knowlective.example.com）。",
  },
};

export default ja;
