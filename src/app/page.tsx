import Link from "next/link";

import { ValueOpportunities } from "@/components/dashboard/value-opportunities";
import { Card } from "@/components/ui/card";
import { SectionTitle } from "@/components/ui/section-title";
import { getDashboardInsights } from "@/lib/api-football/service";
import { getLeagueGroups, TRACKED_LEAGUES } from "@/lib/competition-scope";
import { formatPercent } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { fixtures, opportunities } = await getDashboardInsights();
  const leagueGroups = getLeagueGroups();
  const topEdges = opportunities.flatMap((item) => item.offers);
  const averageEdge =
    topEdges.reduce((sum, offer) => sum + offer.edge, 0) / (topEdges.length || 1);

  return (
    <main className="space-y-8">
      <section className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <Card className="overflow-hidden border-emerald-300/10 bg-gradient-to-br from-slate-950/90 to-slate-900/60">
          <SectionTitle
            eyebrow="Trading Board"
            title="Lectura de mercado con cuotas reales, probabilidad implicita y modelo historico"
            description="La plataforma ya no solo expone partidos: prioriza spots donde la cuota del bookmaker puede estar por encima de la probabilidad estimada por el modelo."
          />
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <QuickStat label="Partidos del radar" value={String(fixtures.length)} />
            <QuickStat label="Ligas seguidas" value={String(TRACKED_LEAGUES.length)} />
            <QuickStat
              label="Edge promedio"
              value={topEdges.length ? formatPercent(averageEdge) : "Sin edge"}
            />
          </div>
        </Card>

        <Card className="border-amber-200/10 bg-slate-950/70">
          <p className="text-xs uppercase tracking-[0.25em] text-amber-200">Workflow</p>
          <ol className="mt-4 space-y-4 text-sm leading-7 text-slate-300">
            <li>1. Identifica partidos del dia con oferta suficiente de cuotas.</li>
            <li>2. Compara probabilidad implicita contra probabilidad historica modelada.</li>
            <li>3. Entra al detalle para revisar si el edge sobrevive a lesiones, forma y tabla.</li>
          </ol>
          <Link
            href="/matches"
            className="mt-6 inline-flex rounded-full bg-emerald-400 px-5 py-3 text-sm font-medium text-slate-950 transition hover:bg-emerald-300"
          >
            Abrir explorador de partidos
          </Link>
        </Card>
      </section>

      <section className="space-y-4">
        <SectionTitle
          eyebrow="Value Radar"
          title="Oportunidades del dia con comparacion real de probabilidades"
          description="Cada bloque usa cuotas reales y las contrasta con un Poisson calibrado por liga, ajustado con ultimos 20 partidos, forma, tabla y correccion para marcadores bajos."
        />
        <ValueOpportunities opportunities={opportunities} />
      </section>

      <section className="space-y-4">
        <SectionTitle
          eyebrow="Cobertura"
          title="Mapa de ligas por categoria"
          description="La cobertura incluye ligas de alta visibilidad, volumen, potencial ineficiente, goles y expansion geografica."
        />
        <div className="grid gap-4 lg:grid-cols-2">
          {leagueGroups.map((group) => (
            <Card key={group.key}>
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-lg font-semibold text-white">{group.label}</h3>
                <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-300">
                  {group.leagues.length} ligas
                </span>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {group.leagues.map((league) => (
                  <span
                    key={`${group.key}-${league.label}`}
                    className="rounded-full border border-white/10 bg-slate-900/60 px-3 py-2 text-xs text-slate-200"
                  >
                    {league.label}
                  </span>
                ))}
              </div>
            </Card>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <SectionTitle
          eyebrow="Agenda"
          title="Partidos del dia para analizar en profundidad"
          description="Accede al detalle para revisar mercados compatibles, forma reciente, ranking y la lectura del modelo."
        />
        <div className="grid gap-4">
          {fixtures.map((fixture) => (
            <Card
              key={fixture.fixture.id}
              className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"
            >
              <div className="space-y-2">
                <p className="text-sm uppercase tracking-[0.2em] text-slate-400">
                  {fixture.league.country}
                </p>
                <h3 className="text-xl text-white">
                  {fixture.teams.home.name} vs {fixture.teams.away.name}
                </h3>
                <p className="text-sm text-slate-300">
                  {fixture.league.name} • {fixture.fixture.venue?.name ?? "Venue TBD"}
                </p>
              </div>
              <div className="flex items-center gap-4">
                <span className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300">
                  {new Date(fixture.fixture.date).toLocaleTimeString("es-CO", {
                    hour: "2-digit",
                    minute: "2-digit"
                  })}
                </span>
                <Link
                  href={`/matches/${fixture.fixture.id}`}
                  className="rounded-full border border-emerald-300/30 px-4 py-2 text-sm text-white transition hover:border-emerald-300"
                >
                  Analizar spot
                </Link>
              </div>
            </Card>
          ))}
        </div>
      </section>
    </main>
  );
}

function QuickStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.5rem] border border-white/10 bg-slate-900/60 p-4">
      <p className="text-sm text-slate-400">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
    </div>
  );
}
