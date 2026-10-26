import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import SiteChrome from "./SiteChrome";
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
  title: {
    default: "College basketball shot charts and ratings",
    template: "%s · CBB",
  },
  description:
    "Shot locations for every Division I team and player, mapped to the " +
    "floor and measured against the rest of the country.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      // SiteChrome's inline script sets data-wire before React hydrates.
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <SiteChrome />
        {children}
      </body>
    </html>
  );
}
