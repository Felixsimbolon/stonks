import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {children}
        <footer className="mx-auto max-w-4xl px-4 py-8 text-xs opacity-60">
          Information tool only — not financial advice. No trades are executed. Data: Sectors.
        </footer>
      </body>
    </html>
  );
}
