-- Workspace → KnowledgeRoot ("ナレッジルート").
-- Renames instead of drop/create so existing data is kept, then gives every
-- knowledge root a root page: a new page titled with the old workspace name,
-- with the workspace's former top-level pages moved under it.

-- Workspace → KnowledgeRoot
ALTER TABLE "Workspace" RENAME TO "KnowledgeRoot";
ALTER TABLE "KnowledgeRoot" RENAME CONSTRAINT "Workspace_pkey" TO "KnowledgeRoot_pkey";
ALTER TABLE "KnowledgeRoot" ADD COLUMN "rootPageId" TEXT;

-- WorkspaceMember → KnowledgeRootMember
ALTER TABLE "WorkspaceMember" RENAME TO "KnowledgeRootMember";
ALTER TABLE "KnowledgeRootMember" RENAME CONSTRAINT "WorkspaceMember_pkey" TO "KnowledgeRootMember_pkey";
ALTER TABLE "KnowledgeRootMember" RENAME COLUMN "workspaceId" TO "rootId";
ALTER TABLE "KnowledgeRootMember" RENAME CONSTRAINT "WorkspaceMember_userId_fkey" TO "KnowledgeRootMember_userId_fkey";
ALTER TABLE "KnowledgeRootMember" RENAME CONSTRAINT "WorkspaceMember_workspaceId_fkey" TO "KnowledgeRootMember_rootId_fkey";
ALTER INDEX "WorkspaceMember_userId_workspaceId_key" RENAME TO "KnowledgeRootMember_userId_rootId_key";

-- Page.workspaceId → Page.rootId
ALTER TABLE "Page" RENAME COLUMN "workspaceId" TO "rootId";
ALTER TABLE "Page" RENAME CONSTRAINT "Page_workspaceId_fkey" TO "Page_rootId_fkey";
ALTER INDEX "Page_workspaceId_idx" RENAME TO "Page_rootId_idx";

-- Invitation.workspaceId / newWorkspaceName → rootId / newRootName
ALTER TABLE "Invitation" RENAME COLUMN "workspaceId" TO "rootId";
ALTER TABLE "Invitation" RENAME COLUMN "newWorkspaceName" TO "newRootName";
ALTER TABLE "Invitation" RENAME CONSTRAINT "Invitation_workspaceId_fkey" TO "Invitation_rootId_fkey";

-- Data: one root page per knowledge root, titled with the old workspace name.
-- Created by the root's first OWNER (else first member, else the creator of
-- its first page, else the first user).
INSERT INTO "Page" ("id", "title", "createdAt", "updatedAt", "rootId", "parentId", "createdById")
SELECT
  'rootpage_' || r."id",
  r."name",
  r."createdAt",
  CURRENT_TIMESTAMP,
  r."id",
  NULL,
  COALESCE(
    (SELECT m."userId" FROM "KnowledgeRootMember" m
      WHERE m."rootId" = r."id"
      ORDER BY (m."role" = 'OWNER') DESC, m."createdAt" LIMIT 1),
    (SELECT p."createdById" FROM "Page" p WHERE p."rootId" = r."id" ORDER BY p."createdAt" LIMIT 1),
    (SELECT u."id" FROM "User" u ORDER BY u."createdAt" LIMIT 1)
  )
FROM "KnowledgeRoot" r;

-- Former top-level pages become children of their root page.
UPDATE "Page" p
SET "parentId" = 'rootpage_' || p."rootId"
WHERE p."parentId" IS NULL AND p."id" <> 'rootpage_' || p."rootId";

UPDATE "KnowledgeRoot" r SET "rootPageId" = 'rootpage_' || r."id";

-- The root's name now lives in its root page's title.
ALTER TABLE "KnowledgeRoot" DROP COLUMN "name", DROP COLUMN "slug";

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeRoot_rootPageId_key" ON "KnowledgeRoot"("rootPageId");

-- AddForeignKey: a root page can't be deleted while its knowledge root exists.
ALTER TABLE "KnowledgeRoot" ADD CONSTRAINT "KnowledgeRoot_rootPageId_fkey" FOREIGN KEY ("rootPageId") REFERENCES "Page"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
