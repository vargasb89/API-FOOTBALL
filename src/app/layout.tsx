import type { Metadata } from "next";

import "@/app/globals.css";
import { Shell } from "@/components/layout/shell";

export const metadata: Metadata = {
  title: "Football Value Lab",
  description: "Plataforma de analisis de apuestas de futbol enfocada en value betting."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
