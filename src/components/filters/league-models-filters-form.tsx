"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type Option = {
  value: string;
  label: string;
};

type LeagueModelsFiltersFormProps = {
  date: string;
  league: string;
  country: string;
  category: string;
  season: string;
  countryOptions: Option[];
  leagueOptions: Array<
    Option & {
      name: string;
      country: string;
      categories: string[];
    }
  >;
  categoryOptions: Option[];
};

export function LeagueModelsFiltersForm({
  date,
  league,
  country,
  category,
  season,
  countryOptions,
  leagueOptions,
  categoryOptions
}: LeagueModelsFiltersFormProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [form, setForm] = useState({
    date,
    league,
    country,
    category,
    season
  });

  const filteredLeagueOptions = useMemo(
    () =>
      leagueOptions.filter((option) => {
        const matchesCountry = form.country ? option.country === form.country : true;
        const matchesCategory = form.category
          ? option.categories.includes(form.category)
          : true;

        return matchesCountry && matchesCategory;
      }),
    [form.category, form.country, leagueOptions]
  );

  const selectedLeague = filteredLeagueOptions.some(
    (option) => option.value === form.league
  )
    ? form.league
    : "";

  function updateField(field: keyof typeof form, value: string) {
    setForm((current) => {
      const next = {
        ...current,
        [field]: value
      };

      if (field === "country") {
        next.league = "";
      }

      if (field === "category" && value && next.league) {
        const currentLeague = leagueOptions.find((option) => option.value === next.league);
        if (currentLeague && !currentLeague.categories.includes(value)) {
          next.league = "";
        }
      }

      return next;
    });
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const params = new URLSearchParams(searchParams.toString());

    syncParam(params, "date", form.date);
    const selectedLeagueOption = filteredLeagueOptions.find(
      (option) => option.value === selectedLeague
    );

    syncParam(params, "league", selectedLeagueOption?.name ?? "");
    syncParam(params, "country", selectedLeagueOption?.country ?? form.country);
    syncParam(params, "category", form.category);
    syncParam(params, "season", form.season);

    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
      <input
        name="date"
        type="date"
        value={form.date}
        onChange={(event) => updateField("date", event.target.value)}
        className="rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-white"
      />

      <select
        name="country"
        value={form.country}
        onChange={(event) => updateField("country", event.target.value)}
        className="rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-white"
      >
        <option value="">Todos los paises</option>
        {countryOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      <select
        name="league"
        value={selectedLeague}
        onChange={(event) => {
          const nextValue = event.target.value;
          const nextOption = filteredLeagueOptions.find(
            (option) => option.value === nextValue
          );

          setForm((current) => ({
            ...current,
            league: nextValue,
            country: nextOption?.country ?? current.country
          }));
        }}
        className="rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-white"
      >
        <option value="">Todas las ligas</option>
        {filteredLeagueOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      <select
        name="category"
        value={form.category}
        onChange={(event) => updateField("category", event.target.value)}
        className="rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-white"
      >
        <option value="">Todas las categorias</option>
        {categoryOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      <input
        name="season"
        placeholder="Temporada"
        value={form.season}
        onChange={(event) => updateField("season", event.target.value)}
        className="rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-white"
      />

      <button className="rounded-full bg-emerald-400 px-5 py-3 text-sm font-medium text-slate-950">
        Ver ligas
      </button>
    </form>
  );
}

function syncParam(params: URLSearchParams, key: string, value: string) {
  if (value.trim()) {
    params.set(key, value);
  } else {
    params.delete(key);
  }
}
