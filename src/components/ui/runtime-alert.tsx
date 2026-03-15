import { Card } from "@/components/ui/card";

export function RuntimeAlert({
  title,
  message
}: {
  title: string;
  message: string;
}) {
  return (
    <Card className="border-amber-300/20 bg-amber-300/5">
      <h3 className="text-lg font-semibold text-amber-200">{title}</h3>
      <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-300">{message}</p>
    </Card>
  );
}
