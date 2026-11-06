import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { withBasePath } from "@/lib/base-path";
import { getBrand } from "@/lib/brand";
import { getTheme } from "@/lib/theme";

// The web app manifest: what "Add to home screen" (and the browser's
// "Install") makes. On iPhone and iPad, desktop notifications only work in a
// site added that way. Named after the site (its name at the top left of the
// sidebars), in the site's background color.
//
// The icons are public/icons/ (and app/apple-icon.png for iOS), rendered from
// app/icon.svg. There's no offline cache: the service worker (public/sw.js)
// only shows notifications, so decrypted pages never stay on the device.
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  await connection();
  const [{ name }, theme, t] = await Promise.all([getBrand(), getTheme(), getTranslations("meta")]);
  return {
    id: withBasePath("/"),
    name,
    short_name: name,
    description: t("description"),
    start_url: withBasePath("/"),
    scope: withBasePath("/"),
    display: "standalone",
    background_color: theme.background,
    theme_color: theme.background,
    icons: [
      { src: withBasePath("/icons/icon-192.png"), sizes: "192x192", type: "image/png", purpose: "any" },
      { src: withBasePath("/icons/icon-512.png"), sizes: "512x512", type: "image/png", purpose: "any" },
      { src: withBasePath("/icons/icon-maskable-512.png"), sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
