-- Page access now comes only from group grants on pages (PageGrant).
-- Individual knowledge root memberships are converted into one group per
-- (knowledge root, role) with a grant on the root page, then removed.

-- CreateEnum
CREATE TYPE "PageAccess" AS ENUM ('VIEW', 'EDIT', 'MANAGE');

-- CreateTable
CREATE TABLE "PageGrant" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "access" "PageAccess" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PageGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvitationGroup" (
    "invitationId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,

    CONSTRAINT "InvitationGroup_pkey" PRIMARY KEY ("invitationId","groupId")
);

-- CreateIndex
CREATE INDEX "PageGrant_groupId_idx" ON "PageGrant"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "PageGrant_pageId_groupId_key" ON "PageGrant"("pageId", "groupId");

-- AddForeignKey
ALTER TABLE "PageGrant" ADD CONSTRAINT "PageGrant_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageGrant" ADD CONSTRAINT "PageGrant_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvitationGroup" ADD CONSTRAINT "InvitationGroup_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "Invitation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvitationGroup" ADD CONSTRAINT "InvitationGroup_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Data: memberships → groups + grants on the root page.
--   OWNER, ADMIN → MANAGE / MEMBER → EDIT / GUEST → VIEW
-- Group name: "<root page title> <role label>", suffixed if already taken.
DO $$
DECLARE
  rec RECORD;
  base_name TEXT;
  candidate TEXT;
  n INT;
  gid TEXT;
BEGIN
  FOR rec IN
    SELECT DISTINCT m."rootId", m."role", r."rootPageId", p."title"
    FROM "KnowledgeRootMember" m
    JOIN "KnowledgeRoot" r ON r."id" = m."rootId"
    JOIN "Page" p ON p."id" = r."rootPageId"
  LOOP
    base_name := COALESCE(NULLIF(rec."title", ''), 'ナレッジルート') || ' ' ||
      CASE rec."role"
        WHEN 'OWNER' THEN 'オーナー'
        WHEN 'ADMIN' THEN '管理者'
        WHEN 'MEMBER' THEN 'メンバー'
        ELSE 'ゲスト'
      END;
    candidate := base_name;
    n := 2;
    WHILE EXISTS (SELECT 1 FROM "Group" WHERE "name" = candidate) LOOP
      candidate := base_name || ' (' || n || ')';
      n := n + 1;
    END LOOP;

    gid := 'grp_' || substr(md5(random()::text || clock_timestamp()::text || rec."rootId" || rec."role"), 1, 21);
    INSERT INTO "Group" ("id", "name", "description", "createdAt")
    VALUES (gid, candidate, '旧ナレッジルートメンバーから移行', CURRENT_TIMESTAMP);

    INSERT INTO "GroupMember" ("groupId", "userId", "createdAt")
    SELECT gid, m."userId", m."createdAt"
    FROM "KnowledgeRootMember" m
    WHERE m."rootId" = rec."rootId" AND m."role" = rec."role";

    INSERT INTO "PageGrant" ("id", "pageId", "groupId", "access")
    VALUES (
      'pg_' || substr(md5(random()::text || clock_timestamp()::text || gid), 1, 22),
      rec."rootPageId",
      gid,
      (CASE rec."role" WHEN 'GUEST' THEN 'VIEW' WHEN 'MEMBER' THEN 'EDIT' ELSE 'MANAGE' END)::"PageAccess"
    );
  END LOOP;
END $$;

-- Unused invitations targeted knowledge roots, which no longer works; they
-- must be reissued with groups. Used ones are kept as history.
DELETE FROM "Invitation" WHERE "usedAt" IS NULL;

-- DropForeignKey
ALTER TABLE "KnowledgeRootMember" DROP CONSTRAINT "KnowledgeRootMember_userId_fkey";

-- DropForeignKey
ALTER TABLE "KnowledgeRootMember" DROP CONSTRAINT "KnowledgeRootMember_rootId_fkey";

-- DropForeignKey
ALTER TABLE "Invitation" DROP CONSTRAINT "Invitation_rootId_fkey";

-- AlterTable
ALTER TABLE "Invitation" DROP COLUMN "newRootName",
DROP COLUMN "role",
DROP COLUMN "rootId";

-- DropTable
DROP TABLE "KnowledgeRootMember";

-- DropEnum
DROP TYPE "MemberRole";
