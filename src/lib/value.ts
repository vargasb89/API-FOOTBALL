export type ValueBetInput = {
  bookmakerOdds: number;
  estimatedProbability: number;
};

export type ValueBetResult = {
  impliedProbability: number;
  edge: number;
  expectedValue: number;
  fairOdds: number;
};

export function calculateValueBet({
  bookmakerOdds,
  estimatedProbability
}: ValueBetInput): ValueBetResult {
  const normalizedProbability =
    estimatedProbability > 1 ? estimatedProbability / 100 : estimatedProbability;
  const impliedProbability = 1 / bookmakerOdds;
  const edge = normalizedProbability - impliedProbability;
  const expectedValue = bookmakerOdds * normalizedProbability - 1;
  const fairOdds = 1 / normalizedProbability;

  return {
    impliedProbability,
    edge,
    expectedValue,
    fairOdds
  };
}
