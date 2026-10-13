-- AlterTable
ALTER TABLE "InstanceConfig" ALTER COLUMN "uploadAllowedExtensions" SET DEFAULT ARRAY['avif', 'bmp', 'csv', 'doc', 'docx', 'gif', 'heic', 'jpeg', 'jpg', 'json', 'm4a', 'markdown', 'md', 'mov', 'mp3', 'mp4', 'odp', 'ods', 'odt', 'ogg', 'pdf', 'png', 'ppt', 'pptx', 'rtf', 'tsv', 'txt', 'wav', 'webm', 'webp', 'xls', 'xlsx', 'zip']::TEXT[];

-- Instances set up before the recommended list existed start from it too
-- (an empty list still means "no restriction" when an administrator clears it).
UPDATE "InstanceConfig" SET "uploadAllowedExtensions" = DEFAULT WHERE cardinality("uploadAllowedExtensions") = 0;
