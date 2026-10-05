// Plain-text email bodies sent by the app. Links must be built from
// getPublicUrl(), never from request headers.

type Mail = { subject: string; text: string };

export function invitationMail(input: {
  link: string;
  inviterName: string;
  rootName: string;
  isNewRoot: boolean;
  roleLabel: string;
  ttlDays: number;
}): Mail {
  const what = input.isNewRoot
    ? `新しいナレッジルート「${input.rootName}」のオーナー`
    : `ナレッジルート「${input.rootName}」の${input.roleLabel}`;
  return {
    subject: "yosuga への招待",
    text: [
      `${input.inviterName} から、yosuga の${what}として招待されました。`,
      "",
      "次のリンクを開いて、アカウントを登録してください。",
      input.link,
      "",
      `このリンクは${input.ttlDays}日間有効で、1回だけ使えます。`,
      "心当たりがない場合は、このメールを無視してください。",
    ].join("\n"),
  };
}
