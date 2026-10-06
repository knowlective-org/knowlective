-- AlterTable
ALTER TABLE "Group" ADD COLUMN     "builtIn" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Group_builtIn_key" ON "Group"("builtIn");


-- Built-in "全ユーザー" group: every enabled user is implicitly a member.
-- Grant it on a page to share that page with all registered users.
INSERT INTO "Group" ("id", "name", "description", "builtIn", "createdAt")
VALUES (
  'grp_all_users',
  CASE WHEN EXISTS (SELECT 1 FROM "Group" WHERE "name" = '全ユーザー') THEN '全ユーザー（組み込み）' ELSE '全ユーザー' END,
  '登録されている有効なユーザー全員（自動）',
  'all_users',
  CURRENT_TIMESTAMP
);
