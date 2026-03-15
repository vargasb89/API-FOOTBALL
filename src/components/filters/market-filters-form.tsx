"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type MarketFiltersFormProps = {
  start: string;
  end: string;
  minOdds: string;
  maxOdds: string;
};

export function MarketFiltersForm({
  start,
  end,
  minOdds,
  maxOdds
}: MarketFiltersFormProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [form, setForm] = useState({
    start,
    end,
    minOdds,
    maxOdds
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

    syncParam(params, "start", form.start);
    syncParam(params, "end", form.end);
    syncParam(params, "min_odds", form.minOdds);
    syncParam(params, "max_odds", form.maxOdds);

    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4 md:grid-cols-4 xl:grid-cols-5">
      <Field label="Desde">
        <input
          name="start"
          type="date"
          value={form.start}
          onChange={(event) => updateField("start", event.target.value)}
          className="rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-white"
        />
      </Field>
      <Field label="Hasta">
        <input
          name="end"
          type="date"
          value={form.end}
          onChange={(event) => updateField("end", event.target.value)}
          className="rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-white"
        />
      </Field>
      <Field label="Cuota minima">
        <input
          name="min_odds"
          type="number"
          step="0.01"
          value={form.minOdds}
          onChange={(event) => updateField("minOdds", event.target.value)}
          className="rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-white"
        />
      </Field>
      <Field label="Cuota maxima">
        <input
          name="max_odds"
          type="number"
          step="0.01"
          value={form.maxOdds}
          onChange={(event) => updateField("maxOdds", event.target.value)}
          className="rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-white"
        />
      </Field>
      <div className="flex items-end">
        <button className="w-full rounded-full bg-emerald-400 px-5 py-3 text-sm font-medium text-slate-950">
          Aplicar filtros
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  children
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="space-y-2">
      <span className="text-xs uppercase tracking-[0.25em] text-emerald-300">{label}</span>
      {children}
    </label>
  );
}

function syncParam(params: URLSearchParams, key: string, value: string) {
  if (value.trim()) {
    params.set(key, value);
  } else {
    params.delete(key);
  }
}
