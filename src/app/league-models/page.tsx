import Link from "next/link";

import { LeagueModelsFiltersForm } from "@/components/filters/league-models-filters-form";
import { Card } from "@/components/ui/card";
import { RuntimeAlert } from "@/components/ui/runtime-alert";
import { SectionTitle } from "@/components/ui/section-title";
import { getConfidenceLabel } from "@/lib/market-analysis";
import {
  getLeagueModelViewData,
  SnapshotUnavailableError
} from "@/lib/api-football/service";
import {
  TRACKED_LEAGUES,
  findTrackedLeague,
  findTrackedLeagueByName,
  getLeagueGroups,
  type LeagueCategory
} from "@/lib/competition-scope";
import {
  formatMatchDateTime,
  getDateInputValueInTimeZone,
  getRequestTimeZone
} from "@/lib/timezone";
import { formatOdds, formatPercent } from "@/lib/utils";

export const dynamic = "force-dynamic";

type LeagueModelsPageProps = {
  searchParams: Promise<{
    date?: string;
    league?: string;
    season?: string;
    country?: string;
    category?: string;
  }>;
};

export default async function LeagueModelsPage({
  searchParams
}: LeagueModelsPageProps) {
  const params = await searchParams;
  const timeZone = await getRequestTimeZone();
  const date = params.date ?? getDateInputValueInTimeZone(new Date(), timeZone);
  let fixtures: Awaited<ReturnType<typeof getLeagueModelViewData>> = [];
  let runtimeError: string | null = null;

  try {
    fixtures = await getLeagueModelViewData({
      date,
      league: params.league,
      season: params.season,
      country: params.country,
      category: params.category,
      timeZone
    });
  } catch (error) {
    runtimeError =
      error instanceof SnapshotUnavailableError
        ? `No se pudo construir el snapshot para la fecha consultada. Se intentó cargar desde el API y no se completó. Detalle: ${error.message}`
        : error instanceof Error
          ? error.message
          : "No se pudo cargar la vista por liga.";
  }

  const leagueGroups = getLeagueGroups();
  const selectedTrackedLeague =
    params.country && params.league
      ? findTrackedLeague(params.country, params.league)
      : params.league
        ? findTrackedLeagueByName(params.league)
        : undefined;
  const countryOptions = [...new Set(TRACKED_LEAGUES.map((league) => league.country))]
    .sort((left, right) => left.localeCompare(right))
    .map((country) => ({
      value: country,
      label: country
    }));
  const leagueOptions = [...TRACKED_LEAGUES]
    .sort((left, right) => left.label.localeCompare(right.label))
    .map((league) => ({
      value: `${league.country}::${league.name}`,
      name: league.name,
      label: league.label,
      country: league.country,
      categories: league.categories
    }));

  return (
    <main className="space-y-6">
      <SectionTitle
        eyebrow="Ver ligas"
        title="Probabilidades del modelo por partido dentro de una liga"
        description="Filtra por fecha, pais, liga o categoria para entrar a cualquier fixture rastreado y revisar las probabilidades del modelo por mercado."
      />

      <Card>
        <LeagueModelsFiltersForm
          key={`league-models-${date}-${params.league ?? ""}-${params.country ?? ""}-${params.category ?? ""}-${params.season ?? ""}`}
          date={date}
          league={
            selectedTrackedLeague
              ? `${selectedTrackedLeague.country}::${selectedTrackedLeague.name}`
              : ""
          }
          country={selectedTrackedLeague?.country ?? params.country ?? ""}
          category={params.category ?? ""}
          season={params.season ?? ""}
          countryOptions={countryOptions}
          leagueOptions={leagueOptions}
          categoryOptions={leagueGroups.map((group) => ({
            value: group.key,
            label: group.label
          }))}
        />
      </Card>

      {runtimeError ? (
        <RuntimeAlert title="Vista sin datos" message={runtimeError} />
      ) : null}

      <div className="grid gap-4">
        {!runtimeError && !fixtures.length ? (
          <Card>
            <div className="rounded-2xl border border-dashed border-white/10 bg-slate-900/30 p-5 text-sm text-slate-300">
              No hay fixtures rastreados para los filtros seleccionados.
              {selectedTrackedLeague?.label
                ? ` Liga: ${selectedTrackedLeague.label}.`
                : params.league
                  ? ` Liga: ${params.league}.`
                  : ""}
              {selectedTrackedLeague?.country
                ? ` Pais: ${selectedTrackedLeague.country}.`
                : params.country
                  ? ` Pais: ${params.country}.`
                  : ""}
              {params.category ? ` Categoria: ${params.category}.` : ""}
              {` Fecha: ${date}.`}
            </div>
          </Card>
        ) : null}

        {fixtures.map(({ fixture, trackedLeague, offers }) => (
          <Card key={fixture.fixture.id}>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-2">
                <p className="text-sm text-slate-400">
                  {fixture.league.country} • {fixture.league.name} • {fixture.league.season}
                </p>
                <h3 className="text-xl text-white">
                  {fixture.teams.home.name} vs {fixture.teams.away.name}
                </h3>
                <p className="text-sm text-slate-300">
                  {formatMatchDateTime(fixture.fixture.date, timeZone)} • Estado{" "}
                  {fixture.fixture.status.short}
                </p>
                {trackedLeague ? (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {trackedLeague.categories.map((category) => (
                      <span
                        key={`${fixture.fixture.id}-${category}`}
                        className="rounded-full border border-white/10 bg-slate-900/60 px-3 py-1 text-xs text-slate-300"
                      >
                        {category}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="flex flex-col items-start gap-2 lg:items-end">
                <p className="text-sm text-slate-400">
                  {trackedLeague?.label ?? "Liga rastreada"}
                </p>
                <Link
                  href={`/matches/${fixture.fixture.id}`}
                  className="rounded-full border border-white/10 px-4 py-2 text-sm text-white"
                >
                  Ver detalle
                </Link>
              </div>
            </div>

            <div className="mt-5 overflow-x-auto">
              {offers.length ? (
                <table className="min-w-full text-left text-sm">
                  <thead className="text-slate-400">
                    <tr>
                      <th className="pb-3">Mercado</th>
                      <th className="pb-3">Modelo</th>
                      <th className="pb-3">Bookmaker</th>
                      <th className="pb-3">Cuota</th>
                      <th className="pb-3">Implicita</th>
                      <th className="pb-3">Edge</th>
                      <th className="pb-3">EV</th>
                      <th className="pb-3">Conf.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {offers.map((offer) => (
                      <tr
                        key={`${fixture.fixture.id}-${offer.key}`}
                        className="border-t border-white/5 text-slate-200"
                      >
                        <td className="py-3">{offer.label}</td>
                        <td className="py-3 text-white">
                          {formatPercent(offer.modeledProbability)}
                        </td>
                        <td className="py-3">{offer.bookmaker}</td>
                        <td className="py-3">{formatOdds(offer.odds)}</td>
                        <td className="py-3">{formatPercent(offer.impliedProbability)}</td>
                        <td className="py-3">
                          <span
                            className={
                              offer.edge > 0 ? "text-emerald-300" : "text-slate-300"
                            }
                          >
                            {formatPercent(offer.edge)}
                          </span>
                        </td>
                        <td className="py-3">{formatPercent(offer.expectedValue)}</td>
                        <td className="py-3">{getConfidenceLabel(offer.confidence)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="rounded-2xl border border-dashed border-white/10 bg-slate-900/30 p-4 text-sm text-slate-300">
                  No hay mercados comparables cargados para este partido todavia.
                </div>
              )}
            </div>
          </Card>
        ))}
      </div>
    </main>
  );
}
