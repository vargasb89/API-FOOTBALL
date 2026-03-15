import Link from "next/link";

import { MarketFiltersForm } from "@/components/filters/market-filters-form";
import { Card } from "@/components/ui/card";
import { RuntimeAlert } from "@/components/ui/runtime-alert";
import { SectionTitle } from "@/components/ui/section-title";
import { getConfidenceLabel } from "@/lib/market-analysis";
import { getTopEdgesByMarketRange } from "@/lib/api-football/service";
import {
  formatMatchDateTime,
  getDateInputValueInTimeZone,
  getRequestTimeZone
} from "@/lib/timezone";
import { formatOdds, formatPercent } from "@/lib/utils";

export const dynamic = "force-dynamic";

type MarketEdgesPageProps = {
  searchParams: Promise<{
    start?: string;
    end?: string;
    min_odds?: string;
    max_odds?: string;
  }>;
};

export default async function MarketEdgesPage({ searchParams }: MarketEdgesPageProps) {
  const params = await searchParams;
  const timeZone = await getRequestTimeZone();
  const start = params.start ?? getDateInputValueInTimeZone(new Date(), timeZone);
  const end = params.end ?? start;
  const minOdds = params.min_odds ? Number(params.min_odds) : undefined;
  const maxOdds = params.max_odds ? Number(params.max_odds) : undefined;
  let groups: Awaited<ReturnType<typeof getTopEdgesByMarketRange>> = [];
  let runtimeError: string | null = null;

  try {
    groups = await getTopEdgesByMarketRange({
      startDateKey: start,
      endDateKey: end,
      minOdds,
      maxOdds,
      timeZone
    });
  } catch (error) {
    runtimeError =
      error instanceof Error ? error.message : "No se pudieron calcular los edges.";
  }

  return (
    <main className="space-y-6">
      <SectionTitle
        eyebrow="Edges por mercado"
        title="Partidos con mayor edge dentro de cada mercado objetivo"
        description="Ranking filtrable por rango de fechas y cuotas. Solo aparecen edges positivos calculados con el modelo refinado."
      />

      <Card>
        <MarketFiltersForm
          key={`markets-${start}-${end}-${params.min_odds ?? ""}-${params.max_odds ?? ""}`}
          start={start}
          end={end}
          minOdds={params.min_odds ?? ""}
          maxOdds={params.max_odds ?? ""}
        />
      </Card>

      {runtimeError ? (
        <RuntimeAlert
          title="Edges no disponibles"
          message={`No se pudo construir el ranking con datos en vivo. Revisa la configuracion del backend o los logs del servidor. Detalle: ${runtimeError}`}
        />
      ) : null}

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
                  <RankCard
                    key={`${group.market}-${fixture.fixture.id}`}
                    fixture={fixture}
                    offer={offer}
                    emphasis={`Edge ${formatPercent(offer.edge)}`}
                    detailLabel="Confianza"
                    detailValue={getConfidenceLabel(offer.confidence)}
                    timeZone={timeZone}
                  />
                ))
              ) : (
                <EmptyMessage message="No hay edge positivo con estos filtros." />
              )}
            </div>
          </Card>
        ))}
      </div>
    </main>
  );
}

function RankCard({
  fixture,
  offer,
  emphasis,
  detailLabel,
  detailValue,
  timeZone
}: {
  fixture: {
    fixture: { id: number; date: string };
    league: { name: string };
    teams: { home: { name: string }; away: { name: string } };
  };
  offer: {
    odds: number;
    impliedProbability: number;
    modeledProbability: number;
    expectedValue: number;
    bookmaker: string;
  };
  emphasis: string;
  detailLabel: string;
  detailValue: string;
  timeZone: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-900/50 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-slate-400">{fixture.league.name}</p>
          <h3 className="mt-1 text-lg text-white">
            {fixture.teams.home.name} vs {fixture.teams.away.name}
          </h3>
          <p className="mt-1 text-xs text-slate-400">{offer.bookmaker}</p>
          <p className="mt-1 text-xs text-slate-500">
            {formatMatchDateTime(fixture.fixture.date, timeZone)}
          </p>
        </div>
        <span className="rounded-full bg-emerald-400/15 px-3 py-1 text-xs font-medium text-emerald-200">
          {emphasis}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-5 gap-3 text-sm">
        <Metric label="Cuota" value={formatOdds(offer.odds)} />
        <Metric label="Implicita" value={formatPercent(offer.impliedProbability)} />
        <Metric label="Modelo" value={formatPercent(offer.modeledProbability)} />
        <Metric label="EV" value={formatPercent(offer.expectedValue)} />
        <Metric label={detailLabel} value={detailValue} />
      </div>

      <Link
        href={`/matches/${fixture.fixture.id}`}
        className="mt-4 inline-flex text-sm text-emerald-300 hover:text-emerald-200"
      >
        Ver detalle del partido
      </Link>
    </div>
  );
}

function EmptyMessage({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/10 bg-slate-900/30 p-4 text-sm text-slate-300">
      {message}
    </div>
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
