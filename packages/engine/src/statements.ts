import type { Scenario, Total } from './model';

/** Rounds half away from zero to a fixed number of decimal places. */
export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  const scaled = Math.abs(value) * factor;
  // The small nudge keeps values such as 1.005 from rounding down because of
  // how binary floating point stores them.
  const rounded = Math.round(scaled + 1e-9) / factor;
  return value < 0 ? -rounded : rounded;
}

/**
 * Computes every total for one period from the line items, following
 * formulas all the way down. Printed totals play no part.
 *
 * A total is left out when any line item it depends on has no value for the
 * period, which is how an income-statement-only year behaves.
 */
export function computeTotals(scenario: Scenario, period: string): Map<string, number> {
  const items = new Map(scenario.lineItems.map((item) => [item.id, item]));
  const totals = new Map(scenario.totals.map((total) => [total.id, total]));
  const computed = new Map<string, number | undefined>();
  const inProgress = new Set<string>();

  const resolve = (id: string): number | undefined => {
    const item = items.get(id);
    if (item !== undefined) return item.values[period];
    if (computed.has(id)) return computed.get(id);
    const total = totals.get(id);
    if (total === undefined) throw new Error(`unknown id "${id}" in scenario "${scenario.id}"`);
    if (inProgress.has(id)) throw new Error(`totals form a cycle at "${id}"`);
    inProgress.add(id);
    let sum: number | undefined = 0;
    for (const term of total.terms) {
      const value = resolve(term.ref);
      if (value === undefined) {
        sum = undefined;
        break;
      }
      sum += term.sign * value;
    }
    inProgress.delete(id);
    computed.set(id, sum);
    return sum;
  };

  const result = new Map<string, number>();
  for (const total of scenario.totals) {
    const value = resolve(total.id);
    if (value !== undefined) result.set(total.id, value);
  }
  return result;
}

export interface FootingRow {
  /** Id of the total, or of the per-share result. */
  readonly check: string;
  readonly kind: 'total' | 'per_share';
  readonly period: string;
  readonly printed: number;
  readonly computed: number;
  readonly matches: boolean;
}

/**
 * Compares every printed total with the sum of its direct components, and
 * every printed per-share figure with its quotient.
 *
 * Each total is checked one level deep, against the figures printed for its
 * components. That is how a reader foots a statement: a subtotal that does
 * not add up is reported on its own line, and the totals above it are judged
 * against the figure the exhibit prints for that subtotal.
 */
export function footingReport(scenario: Scenario): FootingRow[] {
  const items = new Map(scenario.lineItems.map((item) => [item.id, item]));
  const totals = new Map(scenario.totals.map((total) => [total.id, total]));
  const facts = new Map(scenario.facts.map((fact) => [fact.id, fact]));
  const fromLeaves = new Map(
    scenario.periods.map((period) => [period.id, computeTotals(scenario, period.id)]),
  );

  // The figure a reader would see for an id: the line item, else the printed
  // total, else the computed total for lines the exhibit does not print.
  const shown = (id: string, period: string): number | undefined => {
    const item = items.get(id);
    if (item !== undefined) return item.values[period];
    const printed = totals.get(id)?.printed?.[period];
    if (printed !== undefined) return printed;
    return fromLeaves.get(period)?.get(id);
  };

  const sumOfTerms = (total: Total, period: string): number | undefined => {
    let sum = 0;
    for (const term of total.terms) {
      const value = shown(term.ref, period);
      if (value === undefined) return undefined;
      sum += term.sign * value;
    }
    return sum;
  };

  const rows: FootingRow[] = [];
  for (const total of scenario.totals) {
    for (const [period, printed] of Object.entries(total.printed ?? {})) {
      const computed = sumOfTerms(total, period);
      if (computed === undefined) continue;
      rows.push({
        check: total.id,
        kind: 'total',
        period,
        printed,
        computed,
        matches: printed === computed,
      });
    }
  }

  for (const check of scenario.perShareChecks) {
    const result = facts.get(check.result);
    const denominator = facts.get(check.denominator);
    if (result === undefined || denominator === undefined) continue;
    for (const [period, printed] of Object.entries(result.values)) {
      const top = shown(check.numerator, period);
      const bottom = denominator.values[period];
      if (top === undefined || bottom === undefined || bottom === 0) continue;
      const computed = roundTo(top / bottom, check.decimals);
      rows.push({
        check: check.result,
        kind: 'per_share',
        period,
        printed,
        computed,
        matches: printed === computed,
      });
    }
  }
  return rows;
}

export interface BalanceRow {
  readonly period: string;
  readonly assets: number;
  readonly liabilitiesAndEquity: number;
  readonly balanced: boolean;
}

/** Assets against liabilities plus equity, computed from line items, for each period that has a balance sheet. */
export function balanceReport(scenario: Scenario): BalanceRow[] {
  const rows: BalanceRow[] = [];
  for (const period of scenario.periods) {
    const totals = computeTotals(scenario, period.id);
    const assets = totals.get(scenario.balanceIdentity.assets);
    const liabilitiesAndEquity = totals.get(scenario.balanceIdentity.liabilitiesAndEquity);
    if (assets === undefined || liabilitiesAndEquity === undefined) continue;
    rows.push({
      period: period.id,
      assets,
      liabilitiesAndEquity,
      balanced: assets === liabilitiesAndEquity,
    });
  }
  return rows;
}
