-- Whether search engines may index the site. Off (the default): every
-- response carries X-Robots-Tag: noindex, nofollow.
ALTER TABLE "InstanceConfig" ADD COLUMN "searchEnginesAllowed" BOOLEAN NOT NULL DEFAULT false;
