import type { Metadata } from "next";
import { ThemeProvider } from "next-themes";
import { ThemeSync } from "@/components/ThemeSync";
import "./globals.css";

export const metadata: Metadata = {
  title: "DC Metro Sim",
  description: "OpenStreetMap centered on Washington DC",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
          <ThemeSync />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
