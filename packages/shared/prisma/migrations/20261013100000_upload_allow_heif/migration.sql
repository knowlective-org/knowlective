-- AlterTable
ALTER TABLE "InstanceConfig" ALTER COLUMN "uploadAllowedExtensions" SET DEFAULT ARRAY['avif', 'bmp', 'csv', 'doc', 'docx', 'gif', 'heic', 'heif', 'jpeg', 'jpg', 'json', 'm4a', 'markdown', 'md', 'mov', 'mp3', 'mp4', 'odp', 'ods', 'odt', 'ogg', 'pdf', 'png', 'ppt', 'pptx', 'rtf', 'tsv', 'txt', 'wav', 'webm', 'webp', 'xls', 'xlsx', 'zip']::TEXT[];

-- Instances still on the previous default list get the new one; a list an
-- administrator has changed is left alone.
UPDATE "InstanceConfig" SET "uploadAllowedExtensions" = DEFAULT
WHERE "uploadAllowedExtensions" = ARRAY['avif', 'bmp', 'csv', 'doc', 'docx', 'gif', 'heic', 'jpeg', 'jpg', 'json', 'm4a', 'markdown', 'md', 'mov', 'mp3', 'mp4', 'odp', 'ods', 'odt', 'ogg', 'pdf', 'png', 'ppt', 'pptx', 'rtf', 'tsv', 'txt', 'wav', 'webm', 'webp', 'xls', 'xlsx', 'zip']::TEXT[];
