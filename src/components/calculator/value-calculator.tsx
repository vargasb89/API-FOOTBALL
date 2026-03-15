"use client";

import { useState } from "react";

import { Card } from "@/components/ui/card";
import { formatOdds, formatPercent } from "@/lib/utils";
import { calculateValueBet } from "@/lib/value";

export function ValueCalculator() {
  const [bookmakerOdds, setBookmakerOdds] = useState(1.95);
  const [estimatedProbability, setEstimatedProbability] = useState(54);

  const result = calculateValueBet({
    bookmakerOdds,
    estimatedProbability: estimatedProbability / 100
  });

  return (
    <Card className="max-w-3xl">
      <div className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-5">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-emerald-300">
              Calculadora
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-white">
              Evalua si la cuota supera tu probabilidad real
            </h2>
          </div>
          <label className="block">
            <span className="mb-2 block text-sm text-slate-300">Cuota del bookmaker</span>
            <input
              type="number"
              min="1.01"
              step="0.01"
              value={bookmakerOdds}
              onChange={(event) => setBookmakerOdds(Number(event.target.value))}
              className="w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none ring-0"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm text-slate-300">
              Probabilidad estimada del usuario (%)
            </span>
            <input
              type="number"
              min="1"
              max="99"
              step="0.1"
              value={estimatedProbability}
              onChange={(event) => setEstimatedProbability(Number(event.target.value))}
              className="w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none ring-0"
            />
          </label>
        </div>

        <div className="grid gap-4 rounded-[1.5rem] bg-slate-900/70 p-5">
          <Metric label="Probabilidad implicita" value={formatPercent(result.impliedProbability)} />
          <Metric label="Edge" value={formatPercent(result.edge)} />
          <Metric label="Expected value" value={formatPercent(result.expectedValue)} />
          <Metric label="Fair odds" value={formatOdds(result.fairOdds)} />
        </div>
      </div>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/5 bg-slate-950/60 p-4">
      <p className="text-sm text-slate-400">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
    </div>
  );
}
