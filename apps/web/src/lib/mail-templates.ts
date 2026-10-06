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
