import type { Metadata } from "next";
import "./globals.css";
import "leaflet/dist/leaflet.css";

import { ensureDevFbScrapeScheduler } from "@/lib/fb-scraper/dev-scheduler";

export const metadata: Metadata = {
  title: "日日寵 尋寵地圖 - 一站式毛孩走失協尋平台",
  description: "日日寵 尋寵地圖 - 一站式毛孩走失協尋平台",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  ensureDevFbScrapeScheduler();
  return (
    <html lang="en" suppressHydrationWarning className="h-full antialiased">
      <body suppressHydrationWarning className="min-h-full flex flex-col">
        {children}
      </body>
    </html>
  );
}
