import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "A1 Developer Console",
  description: "A-PROJECT master control console"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
