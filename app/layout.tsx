import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DC Metro Sim",
  description: "OpenStreetMap centered on Washington DC",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
