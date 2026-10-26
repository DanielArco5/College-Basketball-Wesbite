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

// Applies a hidden Live Wire before first paint, so a viewer who turned
// the ticker off never sees it flash in. The key matches
// WIRE_STORAGE_KEY in LiveWire.tsx.
const WIRE_PREF_SCRIPT = `try{if(localStorage.getItem("cbb:wire")==="off")document.documentElement.dataset.wire="off"}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      // The inline script may set data-wire before React hydrates.
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: WIRE_PREF_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        <SiteChrome />
        {children}
      </body>
    </html>
  );
}
