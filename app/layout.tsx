import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin", "cyrillic"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SpeakUp AI — English Speaking Coach",
  description: "Разговорная практика английского с ИИ: диалог текстом и голосом, исправления с объяснениями на русском.",
};

export const viewport: Viewport = {
  themeColor: "#05050a",
  colorScheme: "dark",
  // Lets fixed bottom bars use env(safe-area-inset-bottom) on notched phones.
  viewportFit: "cover",
  // The on-screen keyboard shrinks the layout (and 100dvh), so the chat composer stays visible.
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ru" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
