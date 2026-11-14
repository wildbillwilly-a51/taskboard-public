import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Public_Sans } from "next/font/google";
import { SettingsProvider } from "@/components/settings-provider";
import { buildUiSettingsInitScript } from "@/lib/ui-settings";
import { DEFAULT_UI_SKIN, getUiSkinChromeColor } from "@/lib/ui-skins";
import "./globals.css";
import "./skins/shared-structural.css";
import "./skins/architecture.css";
import "./skins/shared-scale.css";
import "./skins/editor-scale.css";
import "./mobile.css";
import "@/components/outage-people-board.css";

const sans = Public_Sans({
  variable: "--font-ui-sans",
  subsets: ["latin"],
});

const mono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Taskboard",
  description:
    "A self-hosted visual planning board with customizable buckets, nested subtasks, checklists, and calendar imports.",
};

export const viewport: Viewport = {
  interactiveWidget: "resizes-content",
  viewportFit: "cover",
  colorScheme: "light dark",
  themeColor: [
    {
      media: "(prefers-color-scheme: light)",
      color: getUiSkinChromeColor(DEFAULT_UI_SKIN, "light"),
    },
    {
      media: "(prefers-color-scheme: dark)",
      color: getUiSkinChromeColor(DEFAULT_UI_SKIN, "dark"),
    },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${mono.variable} h-full antialiased`}
      data-theme-preference="dark"
      data-theme="dark"
      data-theme-variant="neutral"
      data-ui-skin={DEFAULT_UI_SKIN}
      data-density="standard"
      data-font-scale="normal"
      data-background-style="atmospheric"
      data-surface-style="normal"
      data-header-pinned="false"
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: buildUiSettingsInitScript(),
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <SettingsProvider>{children}</SettingsProvider>
      </body>
    </html>
  );
}
