-- The product's name is written in lower case: the site name's default, and
-- the settings still holding the old default.
ALTER TABLE "BrandSettings" ALTER COLUMN "name" SET DEFAULT 'knowlective';
UPDATE "BrandSettings" SET "name" = 'knowlective' WHERE "name" = 'KNOWLECTIVE';
UPDATE "MailSettings" SET "fromName" = 'knowlective' WHERE "fromName" = 'KNOWLECTIVE';
