-- What a page's search index holds changed: every page is indexed again at
-- startup (reindexStalePages() indexes pages without a row).
DELETE FROM "PageSearchIndex";
