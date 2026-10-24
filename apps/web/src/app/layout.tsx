import type { Metadata } from "next";
import { Geist, Geist_Mono, Newsreader } from "next/font/google";
import { connection } from "next/server";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { DialogHost } from "@/components/dialog";
import { getTheme } from "@/lib/theme";
import { themeCss } from "@/lib/theme-tokens";
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

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta");
  return { title: "KNOWLECTIVE", description: t("description") };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // The theme comes from the database, so nothing is prerendered at build time.
  await connection();
  const [theme, locale] = await Promise.all([getTheme(), getLocale()]);
  return (
    <html lang={locale} className={`${geistSans.variable} ${geistMono.variable} ${newsreader.variable}`} data-ui="RootLayout">
      <head>
        {/* Overrides the defaults in globals.css. Values are validated #rrggbb only. */}
        <style id="knowlective-theme" dangerouslySetInnerHTML={{ __html: themeCss(theme) }} />
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
