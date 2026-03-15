import Link from "next/link";

import { Card } from "@/components/ui/card";
import type { FixtureSummary } from "@/lib/api-football/types";
import type { MarketOffer } from "@/lib/market-analysis";
import { formatOdds, formatPercent } from "@/lib/utils";

export function ValueOpportunities({
  opportunities
}: {
  opportunities: Array<{ fixture: FixtureSummary; offers: MarketOffer[] }>;
}) {
  if (!opportunities.length) {
    return (
      <Card>
        <p className="text-sm leading-7 text-slate-300">
          Aun no hay cuotas suficientes en mercados compatibles para destacar valor en
          el radar. En cuanto aparezcan, aqui veras la comparacion entre probabilidad
          implicita y probabilidad del modelo.
        </p>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      {opportunities.map(({ fixture, offers }) => (
        <Card key={fixture.fixture.id} className="overflow-hidden">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.25em] text-slate-400">
                Value setup
              </p>
              <h3 className="mt-2 text-lg font-semibold text-white">
                {fixture.teams.home.name} vs {fixture.teams.away.name}
              </h3>
              <p className="mt-1 text-sm text-slate-400">
                {fixture.league.name} • {fixture.league.country}
              </p>
            </div>
            <span className="rounded-full bg-emerald-400/15 px-3 py-1 text-xs font-medium text-emerald-200">
              {offers.length} lecturas
            </span>
          </div>

          <div className="mt-5 space-y-3">
            {offers.map((offer) => (
              <div
                key={`${fixture.fixture.id}-${offer.key}`}
                className="rounded-2xl border border-white/10 bg-slate-900/60 p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-white">{offer.label}</p>
                    <p className="mt-1 text-xs text-slate-400">{offer.bookmaker}</p>
                  </div>
                  <span className="rounded-full bg-emerald-400/15 px-3 py-1 text-xs font-medium text-emerald-200">
                    Edge {formatPercent(offer.edge)}
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <p className="text-slate-500">Cuota</p>
                    <p className="mt-1 text-lg text-white">{formatOdds(offer.odds)}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Implicita</p>
                    <p className="mt-1 text-lg text-white">
                      {formatPercent(offer.impliedProbability)}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-500">Modelo</p>
                    <p className="mt-1 text-lg text-white">
                      {formatPercent(offer.modeledProbability)}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <Link
            href={`/matches/${fixture.fixture.id}`}
            className="mt-5 inline-flex text-sm text-emerald-300 hover:text-emerald-200"
          >
            Ver desglose completo
          </Link>
        </Card>
      ))}
    </div>
  );
}
