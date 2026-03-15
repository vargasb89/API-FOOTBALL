"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type Option = {
  value: string;
  label: string;
};

type MatchesFiltersFormProps = {
  date: string;
  league: string;
  country: string;
  category: string;
  season: string;
  categoryOptions: Option[];
};

export function MatchesFiltersForm({
  date,
  league,
  country,
  category,
  season,
  categoryOptions
}: MatchesFiltersFormProps) {
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

  function updateField(field: keyof typeof form, value: string) {
    setForm((current) => ({
      ...current,
      [field]: value
    }));
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const params = new URLSearchParams(searchParams.toString());

    syncParam(params, "date", form.date);
    syncParam(params, "league", form.league);
    syncParam(params, "country", form.country);
    syncParam(params, "category", form.category);
    syncParam(params, "season", form.season);

    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4 md:grid-cols-5">
      <input
        name="date"
        type="date"
        value={form.date}
        onChange={(event) => updateField("date", event.target.value)}
        className="rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-white"
      />
      <input
        name="league"
        placeholder="Liga ID"
        value={form.league}
        onChange={(event) => updateField("league", event.target.value)}
        className="rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-white"
      />
      <input
        name="country"
        placeholder="Pais"
        value={form.country}
        onChange={(event) => updateField("country", event.target.value)}
        className="rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-white"
      />
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
      <button className="rounded-full bg-emerald-400 px-5 py-3 text-sm font-medium text-slate-950 md:col-span-5 md:justify-self-start">
        Aplicar filtros
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
