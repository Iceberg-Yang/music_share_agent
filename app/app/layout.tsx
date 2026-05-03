import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "今天听什么局",
  description: "双人音乐抽签，各自分享一首和主题有关的歌",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh">
      <body className="min-h-screen bg-gray-950 text-white antialiased">
        {children}
      </body>
    </html>
  );
}
