import Link from "next/link";

import { Card } from "@/components/ui/card";
import { RuntimeAlert } from "@/components/ui/runtime-alert";
import { SectionTitle } from "@/components/ui/section-title";
import { getConfidenceLabel } from "@/lib/market-analysis";
import { getFixtureContext } from "@/lib/api-football/service";
import { formatMatchDateTime, getRequestTimeZone } from "@/lib/timezone";
import { formatOdds, formatPercent } from "@/lib/utils";

export const dynamic = "force-dynamic";

type MatchDetailPageProps = {
  params: Promise<{ fixtureId: string }>;
};

export default async function MatchDetailPage({ params }: MatchDetailPageProps) {
  const { fixtureId } = await params;
  const timeZone = await getRequestTimeZone();
  let context: Awaited<ReturnType<typeof getFixtureContext>> | null = null;
  let runtimeError: string | null = null;

  try {
    context = await getFixtureContext(Number(fixtureId));
  } catch (error) {
    runtimeError =
      error instanceof Error ? error.message : "No se pudo cargar el partido.";
  }

  if (!context?.fixture) {
    return (
      <main className="space-y-6">
        <Card>No se encontro el partido solicitado.</Card>
        {runtimeError ? (
          <RuntimeAlert
            title="Detalle sin datos"
            message={`El backend no pudo construir el contexto del partido. Detalle: ${runtimeError}`}
          />
        ) : null}
      </main>
    );
  }

  return (
    <main className="space-y-6">
      <SectionTitle
        eyebrow="Detalle de partido"
        title={`${context.fixture.teams.home.name} vs ${context.fixture.teams.away.name}`}
        description="Cruce de informacion entre odds reales, probabilidad implicita y probabilidad modelada con datos historicos para aislar value betting."
      />

      {runtimeError ? (
        <RuntimeAlert
          title="Contexto parcial"
          message={`La pagina pudo abrirse, pero hubo errores al recuperar parte del backend. Detalle: ${runtimeError}`}
        />
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <Card className="space-y-4">
          <p className="text-sm text-slate-400">
            {context.fixture.league.name} • {context.fixture.league.country}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Metric label="Estado" value={context.fixture.fixture.status.short} />
            <Metric
              label="Hora"
              value={formatMatchDateTime(context.fixture.fixture.date, timeZone)}
            />
            <Metric label="Bookmakers" value={String(context.bookmakers.length)} />
            <Metric label="Mercados comparados" value={String(context.marketOffers.length)} />
          </div>
        </Card>

        <Card className="space-y-4">
          <p className="text-xs uppercase tracking-[0.25em] text-emerald-300">
            Variables del modelo
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Metric
              label="GF local"
              value={String(context.homeStats?.goals?.for?.average?.home ?? "-")}
            />
            <Metric
              label="GA local"
              value={String(context.homeStats?.goals?.against?.average?.home ?? "-")}
            />
            <Metric
              label="GF visitante"
              value={String(context.awayStats?.goals?.for?.average?.away ?? "-")}
            />
            <Metric
              label="GA visitante"
              value={String(context.awayStats?.goals?.against?.average?.away ?? "-")}
            />
            <Metric label="Forma local" value={context.homeStats?.form ?? "-"} />
            <Metric label="Forma visitante" value={context.awayStats?.form ?? "-"} />
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <h3 className="text-lg font-semibold text-white">Mercados con edge calculado</h3>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-slate-400">
                <tr>
                  <th className="pb-3">Mercado</th>
                  <th className="pb-3">Bookmaker</th>
                  <th className="pb-3">Cuota</th>
                  <th className="pb-3">Implicita</th>
                  <th className="pb-3">Modelo</th>
                  <th className="pb-3">Conf.</th>
                  <th className="pb-3">Edge</th>
                  <th className="pb-3">EV</th>
                </tr>
              </thead>
              <tbody>
                {context.marketOffers.slice(0, 10).map((offer) => (
                  <tr key={offer.key} className="border-t border-white/5 text-slate-200">
                    <td className="py-3">{offer.label}</td>
                    <td className="py-3">{offer.bookmaker}</td>
                    <td className="py-3">{formatOdds(offer.odds)}</td>
                    <td className="py-3">{formatPercent(offer.impliedProbability)}</td>
                    <td className="py-3">{formatPercent(offer.modeledProbability)}</td>
                    <td className="py-3">{getConfidenceLabel(offer.confidence)}</td>
                    <td className="py-3 text-emerald-300">{formatPercent(offer.edge)}</td>
                    <td className="py-3">{formatPercent(offer.expectedValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <h3 className="text-lg font-semibold text-white">Tabla de clasificacion</h3>
          <div className="mt-4 space-y-3">
            {context.standings.slice(0, 8).map((row) => (
              <div
                key={row.team.id}
                className="flex items-center justify-between rounded-2xl border border-white/10 bg-slate-900/50 px-4 py-3"
              >
                <div>
                  <p className="text-sm text-white">
                    {row.rank}.{" "}
                    <Link
                      href={`/teams/${row.team.id}?league=${context.fixture.league.id}&season=${context.fixture.league.season}`}
                      className="hover:text-emerald-300"
                    >
                      {row.team.name}
                    </Link>
                  </p>
                  <p className="mt-1 text-xs text-slate-400">Forma {row.form ?? "-"}</p>
                </div>
                <div className="text-right text-sm">
                  <p className="text-white">{row.points} pts</p>
                  <p className="mt-1 text-slate-400">DG {row.goalsDiff}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card>
        <h3 className="text-lg font-semibold text-white">Metodologia</h3>
        <p className="mt-3 max-w-4xl text-sm leading-7 text-slate-300">
          El modelo usa un Poisson calibrado por liga: combina baseline goleador de la
          competicion, medias de temporada, ultimos veinte partidos con pesos de
          recencia, fortaleza en tabla, head-to-head reciente y una correccion tipo
          Dixon-Coles para marcadores bajos. A partir de ahi estima BTTS, Over 1.5,
          Over 2.5, Over 3.5, Under 3.5, Home Team Over 1.5 y Away Team Over 1.5, y
          compara cada cuota con su probabilidad implicita para medir edge y EV.
        </p>
      </Card>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-900/50 p-4">
      <p className="text-sm text-slate-400">{label}</p>
      <p className="mt-2 text-lg text-white">{value}</p>
    </div>
  );
}
