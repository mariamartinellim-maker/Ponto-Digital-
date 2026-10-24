import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { ServiceWorker } from "@/components/layout/service-worker";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Ponto Digital CRM", template: "%s · Ponto Digital CRM" },
  description: "CRM da agência Ponto Digital: clientes, funil, atendimento WhatsApp e campanhas.",
  applicationName: "Ponto Digital CRM",
  appleWebApp: { capable: true, title: "Ponto CRM", statusBarStyle: "black-translucent" },
  robots: { index: false, follow: false },
  icons: { icon: "/icon.svg", apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#0a0c1c",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-dvh">
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
