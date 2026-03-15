import type { PropsWithChildren } from "react";
import Link from "next/link";

import { TimeZoneSync } from "@/components/layout/time-zone-sync";

const links = [
  { href: "/", label: "Dashboard" },
  { href: "/matches", label: "Explorador" },
  { href: "/markets", label: "Edges" },
  { href: "/probabilities", label: "Probabilidades" },
  { href: "/calculator", label: "Calculadora" }
];

export function Shell({ children }: PropsWithChildren) {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.25),_transparent_35%),linear-gradient(180deg,#020617_0%,#0f172a_52%,#111827_100%)] text-slate-100">
      <TimeZoneSync />
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-10 flex flex-col gap-6 rounded-[2rem] border border-white/10 bg-slate-950/50 p-6 backdrop-blur md:flex-row md:items-end md:justify-between">
          <div className="space-y-3">
            <p className="text-xs uppercase tracking-[0.35em] text-emerald-300">
              Football Value Lab
            </p>
            <div>
              <h1 className="text-3xl font-semibold text-white sm:text-4xl">
                Analisis de value betting con contexto real de mercado
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-300">
                Comparamos cuotas, rendimiento, tabla, forma, lesiones y lineas para
                detectar valor estadistico antes de entrar al mercado.
              </p>
            </div>
          </div>
          <nav className="flex flex-wrap gap-3">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-200 transition hover:border-emerald-400 hover:text-white"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </header>
        {children}
      </div>
    </div>
  );
}
