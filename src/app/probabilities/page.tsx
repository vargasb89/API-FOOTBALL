import { format } from "date-fns";
import Link from "next/link";

import { MarketFiltersForm } from "@/components/filters/market-filters-form";
import { Card } from "@/components/ui/card";
import { SectionTitle } from "@/components/ui/section-title";
import { getConfidenceLabel } from "@/lib/market-analysis";
import { getTopModelProbabilitiesByMarketRange } from "@/lib/api-football/service";
import { formatPercent } from "@/lib/utils";

export const dynamic = "force-dynamic";

type ProbabilityPageProps = {
  searchParams: Promise<{
    start?: string;
    end?: string;
    min_odds?: string;
    max_odds?: string;
  }>;
};

export default async function ProbabilityPage({ searchParams }: ProbabilityPageProps) {
  const params = await searchParams;
  const start = params.start ?? format(new Date(), "yyyy-MM-dd");
  const end = params.end ?? start;
  const minOdds = params.min_odds ? Number(params.min_odds) : undefined;
  const maxOdds = params.max_odds ? Number(params.max_odds) : undefined;

  const groups = await getTopModelProbabilitiesByMarketRange({
    startDate: new Date(`${start}T12:00:00`),
    endDate: new Date(`${end}T12:00:00`),
    minOdds,
    maxOdds
  });

  return (
    <main className="space-y-6">
      <SectionTitle
        eyebrow="Probabilidades"
        title="Mercados con mayor probabilidad del modelo"
        description="Esta vista ordena por probabilidad modelada aunque no exista edge positivo. Sirve para detectar spots fuertes del modelo y luego revisar si el mercado acompana."
      />

      <Card>
        <MarketFiltersForm
          start={start}
          end={end}
          minOdds={params.min_odds ?? ""}
          maxOdds={params.max_odds ?? ""}
        />
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        {groups.map((group) => (
          <Card key={group.market}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.25em] text-emerald-300">
                  Mercado
                </p>
                <h2 className="mt-2 text-xl font-semibold text-white">{group.label}</h2>
              </div>
              <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-300">
                Top {group.entries.length}
              </span>
            </div>

            <div className="mt-5 space-y-3">
              {group.entries.length ? (
                group.entries.map(({ fixture, offer }) => (
                  <div
                    key={`${group.market}-${fixture.fixture.id}`}
                    className="rounded-2xl border border-white/10 bg-slate-900/50 p-4"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm text-slate-400">{fixture.league.name}</p>
                        <h3 className="mt-1 text-lg text-white">
                          {fixture.teams.home.name} vs {fixture.teams.away.name}
                        </h3>
                        <p className="mt-1 text-xs text-slate-400">{offer.bookmaker}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {new Date(fixture.fixture.date).toLocaleString("es-CO")}
                        </p>
                      </div>
                      <span className="rounded-full bg-sky-400/15 px-3 py-1 text-xs font-medium text-sky-200">
                        Modelo {formatPercent(offer.modeledProbability)}
                      </span>
                    </div>

                    <div className="mt-4 grid grid-cols-5 gap-3 text-sm">
                      <Metric label="Cuota" value={offer.odds.toFixed(2)} />
                      <Metric label="Implicita" value={formatPercent(offer.impliedProbability)} />
                      <Metric label="Edge" value={formatPercent(offer.edge)} />
                      <Metric label="EV" value={formatPercent(offer.expectedValue)} />
                      <Metric label="Confianza" value={getConfidenceLabel(offer.confidence)} />
                    </div>

                    <Link
                      href={`/matches/${fixture.fixture.id}`}
                      className="mt-4 inline-flex text-sm text-emerald-300 hover:text-emerald-200"
                    >
                      Ver detalle del partido
                    </Link>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-white/10 bg-slate-900/30 p-4 text-sm text-slate-300">
                  No hay mercados comparables para este rango y filtro de cuotas.
                </div>
              )}
            </div>
          </Card>
        ))}
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-slate-500">{label}</p>
      <p className="mt-1 text-white">{value}</p>
    </div>
  );
}
