import type { Metadata } from "next";
import { Instrument_Serif, Inter, JetBrains_Mono } from "next/font/google";

import "./globals.css";

import { Signature } from "@/components/Signature";
import { CommandPaletteProvider } from "@/components/CommandPalette/CommandPaletteProvider";
import { ModeProvider } from "@/components/ModeProvider";
import { ChatProvider } from "@/components/ChatProvider";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";

/*
 * Typography loading
 * ------------------
 * Free proxies for PP Editorial New / GT America / Berkeley Mono.
 * Self-hosted, no runtime network request. When premium fonts arrive,
 * swap these three calls for next/font/local calls pointing at the
 * .woff2 files and everything else stays the same.
 */
const displaySerif = Instrument_Serif({
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-display-base",
  display: "swap",
});

const interfaceSans = Inter({
  weight: ["300", "400", "500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-interface-base",
  display: "swap",
});

const mono = JetBrains_Mono({
  weight: ["400", "500"],
  subsets: ["latin"],
  variable: "--font-mono-base",
  display: "swap",
});

export const metadata: Metadata = {
  title: "astra",
  description: "a window into the depths of your world",
  icons: { icon: "/favicon.svg" },
};

// Required for mobile scaling — without this iOS Safari renders the
// page at its default 980px viewport and then zooms it down, which is
// exactly what makes every page feel "crammed" on the phone.
export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  themeColor: "#06080d",
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${displaySerif.variable} ${interfaceSans.variable} ${mono.variable}`}
    >
      <body>
        <ServiceWorkerRegister />
        <ModeProvider>
          <ChatProvider>
            <CommandPaletteProvider>
              {children}
              <Signature />
            </CommandPaletteProvider>
          </ChatProvider>
        </ModeProvider>
      </body>
    </html>
  );
}
