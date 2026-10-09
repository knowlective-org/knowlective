import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { connection } from "next/server";
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

export const metadata: Metadata = {
  title: "YOSUGA",
  description: "セルフホスト可能なドキュメント・ナレッジ共有ツール",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // The theme comes from the database, so nothing is prerendered at build time.
  await connection();
  const theme = await getTheme();
  return (
    <html lang="ja" className={`${geistSans.variable} ${geistMono.variable}`} data-ui="RootLayout">
      <head>
        {/* Overrides the defaults in globals.css. Values are validated #rrggbb only. */}
        <style id="yosuga-theme" dangerouslySetInnerHTML={{ __html: themeCss(theme) }} />
      </head>
      <body>
        {children}
        {/* Shows showAlert / showConfirm / showCopyText (components/dialog.tsx). */}
        <DialogHost />
      </body>
    </html>
  );
}
