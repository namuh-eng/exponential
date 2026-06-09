import { ThemeInitializer } from "@/components/theme-initializer";
import type { Metadata } from "next";
import { Fraunces, Inter, Inter_Tight, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

const interTight = Inter_Tight({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter-tight",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-fraunces",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-jetbrains-mono",
});

export const metadata: Metadata = {
  title: "Exponential",
  description:
    "Exponential is the editorial workspace for building focused software teams.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`dark ${inter.variable} ${interTight.variable} ${fraunces.variable} ${jetbrainsMono.variable}`}
    >
      <body className="min-h-screen bg-[var(--color-sidebar-bg)] font-sans text-[var(--color-text-primary)] antialiased transition-colors">
        <ThemeInitializer />
        {children}
      </body>
    </html>
  );
}
