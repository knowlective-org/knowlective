import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Newsreader, Noto_Sans_JP } from "next/font/google";
import { connection } from "next/server";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { DialogHost } from "@/components/dialog";
import { withBasePath } from "@/lib/base-path";
import { getBrand } from "@/lib/brand";
import { siteFaviconHref } from "@/lib/site-favicon";
import { getPublicUrl } from "@/lib/site-url";
import { getTheme } from "@/lib/theme";
import { themeCss } from "@/lib/theme-tokens";
import { RESTORE_SIDEBAR_SCRIPT } from "@/lib/sidebar-hidden";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// The site's name at the top left of the sidebars (components/brand.tsx).
const newsreader = Newsreader({
  variable: "--font-brand",
  weight: "600",
  subsets: ["latin"],
});

// A presentation's slides: one font for everyone, so text breaks into lines
// the same on every screen and in the PDF. Loaded only where it's used.
const slideFont = Noto_Sans_JP({
  variable: "--font-slide",
  weight: ["100", "200", "300", "400", "500", "600", "700", "800", "900"],
  preload: false,
});

// Every screen's title ends with the site's name (left at the top of the
// sidebars, components/brand.tsx). Relative URLs in the metadata (Open Graph)
// are under the public URL. The tab's icon is the one set in the admin
// console (lib/site-favicon.ts), or the default; not a file-based icon
// (app/icon.*), which would always win over it.
export async function generateMetadata(): Promise<Metadata> {
  const [t, brand, base, favicon] = await Promise.all([getTranslations("meta"), getBrand(), getPublicUrl(), siteFaviconHref()]);
  return {
    title: { default: brand.name, template: `%s | ${brand.name}` },
    description: t("description"),
    applicationName: brand.name,
    metadataBase: new URL(`${base}/`),
    // (Icons set here replace the file-based ones, so the home screen's is
    // named here too.)
    icons: { icon: [{ url: withBasePath(favicon.href), type: favicon.type }], apple: [{ url: withBasePath("/apple-icon.png"), sizes: "180x180" }] },
    // Added to an iPhone's or iPad's home screen: opens without the browser's
    // bars, named after the site (the icon is public/apple-icon.png).
    appleWebApp: { capable: true, title: brand.name, statusBarStyle: "default" },
  };
}

// The browser's bars (and an installed app's title bar) in the site's
// background color.
export async function generateViewport(): Promise<Viewport> {
  await connection();
  const theme = await getTheme();
  return { themeColor: theme.background };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // The theme comes from the database, so nothing is prerendered at build time.
  await connection();
  const [theme, locale] = await Promise.all([getTheme(), getLocale()]);
  return (
    // (suppressHydrationWarning: the sidebar script below may set data-sidebar
    // on <html> before React hydrates it.)
    <html lang={locale} className={`${geistSans.variable} ${geistMono.variable} ${newsreader.variable} ${slideFont.variable}`} data-ui="RootLayout" suppressHydrationWarning>
      <head>
        {/* Overrides the defaults in globals.css. Values are validated #rrggbb only. */}
        <style id="knowlective-theme" dangerouslySetInnerHTML={{ __html: themeCss(theme) }} />
        {/* The sidebar as it was left (hidden or not), before anything is drawn. */}
        <script dangerouslySetInnerHTML={{ __html: RESTORE_SIDEBAR_SCRIPT }} />
      </head>
      <body>
        {/* Hands the request's language and text to client components. */}
        <NextIntlClientProvider>
          {children}
          {/* Shows showAlert / showConfirm / showCopyText (components/dialog.tsx). */}
          <DialogHost />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
