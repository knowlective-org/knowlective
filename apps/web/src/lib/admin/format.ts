// Display helpers shared by the /admin pages.

export const dateFormat = new Intl.DateTimeFormat("ja-JP", {
  dateStyle: "short",
  timeStyle: "medium",
  timeZone: process.env.TZ || "Asia/Tokyo",
});

export const REASON_LABELS: Record<string, string> = {
  bad_credentials: "認証失敗",
  locked: "ロック中",
  bad_credentials_cleared: "認証失敗（ロック解除済み）",
  ip_denied: "IP 制限",
};

export const ACCESS_LABELS: Record<string, string> = {
  VIEW: "閲覧",
  EDIT: "編集",
  MANAGE: "管理",
};
