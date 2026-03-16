import Link from "next/link";

import { MatchesFiltersForm } from "@/components/filters/matches-filters-form";
import { Card } from "@/components/ui/card";
import { RuntimeAlert } from "@/components/ui/runtime-alert";
import { SectionTitle } from "@/components/ui/section-title";
import {
  getMatchExplorerData,
  SnapshotUnavailableError
} from "@/lib/api-football/service";
import {
  findTrackedLeague,
  getLeagueGroups,
  type LeagueCategory
} from "@/lib/competition-scope";
import {
  formatMatchTime,
  getDateInputValueInTimeZone,
  getRequestTimeZone
} from "@/lib/timezone";

export const dynamic = "force-dynamic";

type MatchExplorerPageProps = {
  searchParams: Promise<{
    date?: string;
    league?: string;
    season?: string;
    country?: string;
    category?: string;
  }>;
};

export default async function MatchExplorerPage({
  searchParams
}: MatchExplorerPageProps) {
  const params = await searchParams;
  const timeZone = await getRequestTimeZone();
  const date = params.date ?? getDateInputValueInTimeZone(new Date(), timeZone);
  let fixtures: Awaited<ReturnType<typeof getMatchExplorerData>> = [];
  let runtimeError: string | null = null;

  try {
    fixtures = await getMatchExplorerData({
      date,
      league: params.league,
      season: params.season,
      timeZone
    });
  } catch (error) {
    runtimeError =
      error instanceof SnapshotUnavailableError
        ? `La fecha consultada todavia no tiene snapshot guardado. Carga primero ese dia y luego vuelve a consultar. Detalle: ${error.message}`
        : error instanceof Error
          ? error.message
          : "No se pudo cargar el explorador.";
  }

  const leagueGroups = getLeagueGroups();

  const filteredFixtures = fixtures.filter((fixture) => {
    const byCountry = params.country ? fixture.league.country === params.country : true;
    const trackedLeague = findTrackedLeague(fixture.league.country, fixture.league.name);
    const byCategory = params.category
      ? trackedLeague?.categories.includes(params.category as LeagueCategory)
      : true;

    return byCountry && byCategory;
  });

  return (
    <main className="space-y-6">
      <SectionTitle
        eyebrow="Explorador"
        title="Filtra partidos por fecha, pais y categoria de liga"
        description="Puedes navegar por las ligas principales, secundarias, ineficientes, de goles o expansion geografica para enfocar mejor la busqueda de value."
      />

      <Card>
        <MatchesFiltersForm
          key={`matches-${date}-${params.league ?? ""}-${params.country ?? ""}-${params.category ?? ""}-${params.season ?? ""}`}
          date={date}
          league={params.league ?? ""}
          country={params.country ?? ""}
          category={params.category ?? ""}
          season={params.season ?? ""}
          categoryOptions={leagueGroups.map((group) => ({
            value: group.key,
            label: group.label
          }))}
        />
      </Card>

      {runtimeError ? (
        <RuntimeAlert
          title="Explorador sin datos"
          message={runtimeError}
        />
      ) : null}

      <div className="grid gap-4">
        {filteredFixtures.map((fixture) => {
          const trackedLeague = findTrackedLeague(
            fixture.league.country,
            fixture.league.name
          );

          return (
            <Card key={fixture.fixture.id}>
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="space-y-2">
                  <p className="text-sm text-slate-400">
                    {fixture.league.country} • {fixture.league.name} • {fixture.league.season}
                  </p>
                  <h3 className="text-xl text-white">
                    {fixture.teams.home.name} vs {fixture.teams.away.name}
                  </h3>
                  <p className="text-sm text-slate-300">
                    Hora {formatMatchTime(fixture.fixture.date, timeZone)} • Estado{" "}
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
                <Link
                  href={`/matches/${fixture.fixture.id}`}
                  className="rounded-full border border-white/10 px-4 py-2 text-sm text-white"
                >
                  Ver detalle
                </Link>
              </div>
            </Card>
          );
        })}
      </div>
    </main>
  );
}
