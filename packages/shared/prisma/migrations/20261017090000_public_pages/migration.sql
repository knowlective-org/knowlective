-- Public pages: viewable without logging in, if a site admin allows it.
ALTER TABLE "InstanceConfig" ADD COLUMN "publicPagesAllowed" BOOLEAN NOT NULL DEFAULT false;

-- Built-in "public" group: everyone, logged in or not, is implicitly a
-- member. Granted VIEW on a page (and so its subtree) to make it public.
INSERT INTO "Group" ("id", "name", "description", "builtIn", "createdAt")
VALUES (
  'grp_public',
  CASE WHEN EXISTS (SELECT 1 FROM "Group" WHERE "name" = 'インターネットに公開') THEN 'インターネットに公開（組み込み）' ELSE 'インターネットに公開' END,
  'ログインしていない人も含む全員（自動）。閲覧のみ',
  'public',
  CURRENT_TIMESTAMP
);
