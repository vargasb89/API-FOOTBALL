import { ValueCalculator } from "@/components/calculator/value-calculator";
import { SectionTitle } from "@/components/ui/section-title";

export default function CalculatorPage() {
  return (
    <main className="space-y-6">
      <SectionTitle
        eyebrow="Calculadora"
        title="Convierte tu lectura del partido en una decision cuantificada"
        description="Introduce la cuota ofrecida y tu probabilidad estimada para ver probabilidad implicita, edge, expected value y fair odds."
      />
      <ValueCalculator />
    </main>
  );
}
