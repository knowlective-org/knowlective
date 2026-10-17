// Plain-text email bodies sent by the app. Links must be built from
// getPublicUrl(), never from request headers.

type Mail = { subject: string; text: string };

export function invitationMail(input: {
  link: string;
  inviterName: string;
  siteRoleLabel: string;
  groupNames: string[];
  ttlDays: number;
}): Mail {
  return {
    subject: "KNOWLECTIVE への招待",
    text: [
      `${input.inviterName} から、KNOWLECTIVE に${input.siteRoleLabel}として招待されました。`,
      ...(input.groupNames.length > 0
        ? [`登録すると、次のグループに参加します: ${input.groupNames.join("、")}`]
        : []),
      "",
      "次のリンクを開いて、アカウントを登録してください。",
      input.link,
      "",
      `このリンクは${input.ttlDays}日間有効で、1回だけ使えます。`,
      "心当たりがない場合は、このメールを無視してください。",
    ].join("\n"),
  };
}

// /signup: confirms the address and opens the registration page.
export function signupMail(input: { link: string; ttlHours: number }): Mail {
  return {
    subject: "KNOWLECTIVE アカウント登録のご案内",
    text: [
      "KNOWLECTIVE のアカウント登録を受け付けました。",
      "",
      "次のリンクを開いて、表示名とパスワードを設定してください。",
      input.link,
      "",
      `このリンクは${input.ttlHours}時間有効で、1回だけ使えます。`,
      "心当たりがない場合は、このメールを無視してください（アカウントは作られません）。",
    ].join("\n"),
  };
}

// /signup for an address that already has an account. Sent instead of a
// registration link, so the form itself never reveals who is registered.
export function alreadyRegisteredMail(input: { loginLink: string }): Mail {
  return {
    subject: "KNOWLECTIVE アカウント登録について",
    text: [
      "このメールアドレスで KNOWLECTIVE のアカウント登録が申し込まれましたが、すでにアカウントがあります。",
      "",
      "次のリンクからログインしてください。",
      input.loginLink,
      "",
      "パスワードがわからない場合は、ログイン画面の「パスワードを忘れた場合」から再設定できます。",
      "心当たりがない場合は、このメールを無視してください。",
    ].join("\n"),
  };
}

// /forgot-password, or a link a site admin chose to mail from /admin/users.
export function passwordResetMail(input: { link: string; ttl: string; byAdmin: boolean }): Mail {
  return {
    subject: "KNOWLECTIVE パスワードの再設定",
    text: [
      input.byAdmin
        ? "管理者が、KNOWLECTIVE のパスワード再設定用のリンクを発行しました。"
        : "KNOWLECTIVE のパスワードの再設定を受け付けました。",
      "",
      "次のリンクを開いて、新しいパスワードを設定してください。",
      input.link,
      "",
      `このリンクは${input.ttl}有効で、1回だけ使えます。再設定すると、ログイン中の端末はすべてログアウトします。`,
      "心当たりがない場合は、このメールを無視してください（パスワードは変わりません）。",
    ].join("\n"),
  };
}
