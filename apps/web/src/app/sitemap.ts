import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { sitemapPages } from "@/lib/seo";
import { getPublicUrl } from "@/lib/site-url";

// /sitemap.xml: the public pages, while search engines are allowed (empty
// otherwise). Only their addresses and when they last changed (lib/seo.ts).
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection();
  const [pages, base] = await Promise.all([sitemapPages(), getPublicUrl()]);
  return pages.map((p) => ({ url: `${base}/pages/${p.id}`, lastModified: p.updatedAt }));
}
