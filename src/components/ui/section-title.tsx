export function SectionTitle({
  eyebrow,
  title,
  description
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs uppercase tracking-[0.28em] text-emerald-300">{eyebrow}</p>
      <h2 className="text-2xl font-semibold text-white">{title}</h2>
      <p className="max-w-2xl text-sm text-slate-300">{description}</p>
    </div>
  );
}
