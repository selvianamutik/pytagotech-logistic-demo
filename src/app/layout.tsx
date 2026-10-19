import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PT Logistik Demo - Admin Panel",
  description: "Panel administrasi internal PT Logistik Demo",
  icons: {
    icon: "/logo.png",
    apple: "/logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
