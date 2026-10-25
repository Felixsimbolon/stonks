import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const display = Instrument_Serif({
  variable: "--font-display",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "Stonks — Evidence-first watchlist investigator",
  description:
    "See what moved a stock, test which explanation holds, and know what would prove it wrong.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      {/* suppressHydrationWarning: browser extensions (e.g. Grammarly) add attributes to <body> before React hydrates */}
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${display.variable} antialiased`}
        suppressHydrationWarning
      >
        <div className="atmosphere" aria-hidden />
        <div className="vignette" aria-hidden />

        <header className="mx-auto flex max-w-6xl items-baseline justify-between px-5 pt-8 sm:px-8">
          <Link href="/" className="display text-3xl italic tracking-tight">
            stonks<span className="text-stock">.</span>
          </Link>
          <nav className="flex items-baseline gap-6">
            <Link href="/" className="eyebrow transition-colors hover:text-ink">
              watchlist
            </Link>
            <Link href="/cases" className="eyebrow transition-colors hover:text-ink">
              case files
            </Link>
          </nav>
        </header>

        {children}

        <footer className="mx-auto max-w-6xl px-5 pb-10 pt-24 sm:px-8">
          <div className="hairline mb-6" />
          <p className="text-xs leading-relaxed text-faint">
            An information tool, not financial advice. Stonks never places trades. Market data from Sectors.
          </p>
        </footer>
      </body>
    </html>
  );
}
