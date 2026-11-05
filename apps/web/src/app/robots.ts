import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { searchEnginesAllowed } from "@/lib/seo";
import { getPublicUrl } from "@/lib/site-url";

// /robots.txt. Nothing is disallowed: while search engines aren't allowed,
// every response says noindex instead (server/robots.ts), which a crawler
// kept out by robots.txt would never read. Once they're allowed, it points
// to the sitemap of the public pages (app/sitemap.ts).
export default async function robots(): Promise<MetadataRoute.Robots> {
  await connection();
  const allowed = await searchEnginesAllowed();
  return {
    rules: { userAgent: "*", allow: "/" },
    ...(allowed && { sitemap: `${await getPublicUrl()}/sitemap.xml` }),
  };
}
