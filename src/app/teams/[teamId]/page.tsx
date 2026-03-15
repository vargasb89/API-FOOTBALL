import { Card } from "@/components/ui/card";
import { SectionTitle } from "@/components/ui/section-title";
import { getTeamPageData } from "@/lib/api-football/service";
import { getEnv } from "@/lib/config/env";

export const dynamic = "force-dynamic";

type TeamPageProps = {
  params: Promise<{ teamId: string }>;
  searchParams: Promise<{ league?: string; season?: string }>;
};

export default async function TeamPage({ params, searchParams }: TeamPageProps) {
  const env = getEnv();
  const { teamId } = await params;
  const filters = await searchParams;
  const league = Number(filters.league ?? 39);
  const season = Number(filters.season ?? env.DEFAULT_SEASON);
  const team = await getTeamPageData(Number(teamId), league, season);

  return (
    <main className="space-y-6">
      <SectionTitle
        eyebrow="Equipo"
        title={team.statistics?.team.name ?? "Analisis de equipo"}
        description="Seccion para revisar rendimiento de temporada, forma y diferencias local/visitante antes de valorar mercados derivados."
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Metric label="Forma reciente" value={team.statistics?.form ?? "-"} />
        <Metric
          label="Goles a favor"
          value={String(team.statistics?.goals?.for?.total?.total ?? "-")}
        />
        <Metric
          label="Goles en contra"
          value={String(team.statistics?.goals?.against?.total?.total ?? "-")}
        />
        <Metric label="Posicion" value={String(team.standing?.rank ?? "-")} />
      </div>

      <Card>
        <h3 className="text-lg font-semibold text-white">Local vs visitante</h3>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <SplitMetric
            title="Promedio goles a favor"
            home={team.statistics?.goals?.for?.average?.home ?? "-"}
            away={team.statistics?.goals?.for?.average?.away ?? "-"}
          />
          <SplitMetric
            title="Promedio goles en contra"
            home={team.statistics?.goals?.against?.average?.home ?? "-"}
            away={team.statistics?.goals?.against?.average?.away ?? "-"}
          />
        </div>
      </Card>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <p className="text-sm text-slate-400">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-white">{value}</p>
    </Card>
  );
}

function SplitMetric({
  title,
  home,
  away
}: {
  title: string;
  home: string;
  away: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-900/50 p-4">
      <p className="text-sm text-slate-300">{title}</p>
      <div className="mt-4 grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Home</p>
          <p className="mt-2 text-2xl text-white">{home}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Away</p>
          <p className="mt-2 text-2xl text-white">{away}</p>
        </div>
      </div>
    </div>
  );
}
