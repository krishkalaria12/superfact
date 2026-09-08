import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";

import "../index.css";
import Header from "@/components/header";
import Providers from "@/components/providers";

/**
 * IBM Plex, because this is a reading instrument for technical documents.
 *
 * The sans was drawn for engineering documentation and keeps its figures on a fixed width, which
 * matters when half the screen is numbers a reader is comparing down a column. The mono carries
 * everything that is a citation rather than a sentence: canonical values, line IDs, page numbers.
 */
const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Superfact",
  description: "Every fact carries the region of the page that proves it",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${plexSans.variable} ${plexMono.variable} antialiased`}>
        <Providers>
          <div className="grid h-svh grid-rows-[auto_1fr] overflow-hidden">
            <Header />
            <div className="min-h-0 overflow-y-auto">{children}</div>
          </div>
        </Providers>
      </body>
    </html>
  );
}
