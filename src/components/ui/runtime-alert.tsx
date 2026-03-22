import { Card } from "@/components/ui/card";

export function RuntimeAlert({
  title,
  message,
  tone = "warning"
}: {
  title: string;
  message: string;
  tone?: "warning" | "info";
}) {
  const styles =
    tone === "info"
      ? {
          card: "border-sky-300/20 bg-sky-300/5",
          title: "text-sky-200"
        }
      : {
          card: "border-amber-300/20 bg-amber-300/5",
          title: "text-amber-200"
        };

  return (
    <Card className={styles.card}>
      <h3 className={`text-lg font-semibold ${styles.title}`}>{title}</h3>
      <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-300">{message}</p>
    </Card>
  );
}
