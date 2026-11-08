-- Built-in "監査" (auditors) group: its members, added by a site admin, can
-- view every page outside the personal roots and see the admin console
-- without changing anything. It can't be deleted.
INSERT INTO "Group" ("id", "name", "description", "builtIn", "createdAt")
VALUES (
  'grp_auditors',
  CASE WHEN EXISTS (SELECT 1 FROM "Group" WHERE "name" = '監査') THEN '監査（組み込み）' ELSE '監査' END,
  'すべてのページの閲覧と、管理画面の閲覧（変更はできない）',
  'auditors',
  CURRENT_TIMESTAMP
);
