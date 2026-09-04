import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Household wellness",
  description: "A calm daily view of household sleep and recovery.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
