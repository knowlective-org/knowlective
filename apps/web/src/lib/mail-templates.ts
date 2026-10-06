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
    subject: "yosuga への招待",
    text: [
      `${input.inviterName} から、yosuga に${input.siteRoleLabel}として招待されました。`,
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
    subject: "yosuga アカウント登録のご案内",
    text: [
      "yosuga のアカウント登録を受け付けました。",
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
    subject: "yosuga アカウント登録について",
    text: [
      "このメールアドレスで yosuga のアカウント登録が申し込まれましたが、すでにアカウントがあります。",
      "",
      "次のリンクからログインしてください。",
      input.loginLink,
      "",
      "パスワードがわからない場合は、管理者に連絡してください。",
      "心当たりがない場合は、このメールを無視してください。",
    ].join("\n"),
  };
}
