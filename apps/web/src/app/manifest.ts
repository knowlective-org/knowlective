import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { withBasePath } from "@/lib/base-path";
import { getBrand } from "@/lib/brand";

// The web app manifest: what "Add to home screen" makes. On iPhone and iPad,
// desktop notifications only work in a site added that way. Named after the
// site (its name at the top left of the sidebars).
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  await connection();
  const { name } = await getBrand();
  return {
    name,
    short_name: name,
    start_url: withBasePath("/"),
    scope: withBasePath("/"),
    display: "standalone",
    background_color: "#ffffff",
  };
}
