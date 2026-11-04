import type { MetadataRoute } from "next";
import { withBasePath } from "@/lib/base-path";

// The web app manifest: what "Add to home screen" makes. On iPhone and iPad,
// desktop notifications only work in a site added that way.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "KNOWLECTIVE",
    short_name: "KNOWLECTIVE",
    start_url: withBasePath("/"),
    scope: withBasePath("/"),
    display: "standalone",
    background_color: "#ffffff",
  };
}
