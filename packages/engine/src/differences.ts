/**
 * The year-over-year difference view and the materiality test, for the
 * Investigator role.
 */
import type { LineItem, Scenario, StatementKind, Total } from './model';
import { computeTotals } from './statements';

export interface StatementRow {
  readonly id: string;
  readonly label: string;
  readonly statement: StatementKind;
  readonly section: string;
  readonly kind: 'line' | 'total';
  /** False for a total the exhibit does not print, which a screen showing the exhibit should leave out. */
  readonly printed: boolean;
}

/**
 * The rows of the statements in reading order.
 *
 * Line items keep the order of the scenario file. Each total goes directly
 * after the last of the rows it adds up, which is where a statement prints it.
 */
export function statementRows(scenario: Scenario): StatementRow[] {
  const rows: StatementRow[] = scenario.lineItems.map((item: LineItem) => ({
    id: item.id,
    label: item.label,
    statement: item.statement,
    section: item.section,
    kind: 'line',
    printed: true,
  }));

  const pending: Total[] = [...scenario.totals];
  while (pending.length > 0) {
    // A total can be placed once every row it adds up has been placed.
    const index = pending.findIndex((total) =>
      total.terms.every((term) => rows.some((row) => row.id === term.ref)),
    );
    const total = pending[index];
    if (total === undefined) {
      throw new Error(`totals in scenario "${scenario.id}" refer to rows that do not exist`);
    }
    pending.splice(index, 1);
    const lastTerm = Math.max(
      ...total.terms.map((term) => rows.findIndex((row) => row.id === term.ref)),
    );
    rows.splice(lastTerm + 1, 0, {
      id: total.id,
      label: total.label,
      statement: total.statement,
      section: total.section,
      kind: 'total',
      printed: total.printed !== undefined,
    });
  }
  return rows;
}

export interface DifferenceRow extends StatementRow {
  readonly current: number;
  readonly prior: number;
  readonly change: number;
  /** Change as a percent of the prior figure. Absent when the prior figure is zero. */
  readonly percentChange: number | undefined;
}

/**
 * A figure as a reader of the exhibit sees it: the line item, or the printed
 * total, or the computed total for a line the exhibit does not print.
 */
function shownValues(scenario: Scenario, period: string): Map<string, number> {
  const values = computeTotals(scenario, period);
  for (const total of scenario.totals) {
    const printed = total.printed?.[period];
    if (printed !== undefined) values.set(total.id, printed);
  }
  for (const item of scenario.lineItems) {
    const value = item.values[period];
    if (value !== undefined) values.set(item.id, value);
  }
  return values;
}

/**
 * Every row that has a figure in both periods, with its change from the prior
 * period to the current one. Totals use the figures the exhibit prints.
 */
export function differenceReport(
  scenario: Scenario,
  current: string,
  prior: string,
): DifferenceRow[] {
  const now = shownValues(scenario, current);
  const before = shownValues(scenario, prior);
  const report: DifferenceRow[] = [];
  for (const row of statementRows(scenario)) {
    const currentValue = now.get(row.id);
    const priorValue = before.get(row.id);
    if (currentValue === undefined || priorValue === undefined) continue;
    const change = currentValue - priorValue;
    report.push({
      ...row,
      current: currentValue,
      prior: priorValue,
      change,
      percentChange: priorValue === 0 ? undefined : (change / Math.abs(priorValue)) * 100,
    });
  }
  return report;
}

export interface MaterialityOptions {
  /** Share of revenue, for example 0.01 for 1%. */
  readonly revenueShare: number;
  /** Share of net income, for example 0.1 for 10%. */
  readonly netIncomeShare: number;
  /** Which year's revenue and net income the thresholds are measured on. */
  readonly base: 'prior' | 'current';
  /** Whether a change must pass either test or both to count as material. */
  readonly rule: 'either' | 'both';
}

/**
 * The project description gives the thresholds (1% of net sales, 10% of net
 * income) and does not say which year or how the two combine. The default
 * measures them on the prior year and counts a change that passes either.
 */
export const DEFAULT_MATERIALITY: MaterialityOptions = {
  revenueShare: 0.01,
  netIncomeShare: 0.1,
  base: 'prior',
  rule: 'either',
};

export interface MaterialityThresholds {
  readonly basePeriod: string;
  /** In $ millions, unrounded. */
  readonly revenue: number;
  readonly netIncome: number;
}

export interface MaterialityRow extends DifferenceRow {
  readonly passesRevenueTest: boolean;
  readonly passesNetIncomeTest: boolean;
  readonly material: boolean;
}

export interface MaterialityReport {
  readonly thresholds: MaterialityThresholds;
  readonly rows: readonly MaterialityRow[];
}

/**
 * The difference view with each change judged against the two thresholds.
 * A change passes a test when its size is at least the threshold.
 */
export function materialityReport(
  scenario: Scenario,
  current: string,
  prior: string,
  options: MaterialityOptions = DEFAULT_MATERIALITY,
): MaterialityReport {
  const basePeriod = options.base === 'prior' ? prior : current;
  const base = shownValues(scenario, basePeriod);
  const revenue = base.get('revenue');
  const netIncome = base.get('net_income');
  if (revenue === undefined || netIncome === undefined) {
    throw new Error(
      `scenario "${scenario.id}" has no revenue or net_income for period "${basePeriod}"`,
    );
  }
  const thresholds: MaterialityThresholds = {
    basePeriod,
    revenue: options.revenueShare * Math.abs(revenue),
    netIncome: options.netIncomeShare * Math.abs(netIncome),
  };

  const rows = differenceReport(scenario, current, prior).map((row): MaterialityRow => {
    // The small allowance keeps a change that sits exactly on a threshold from
    // failing because of how binary floating point stores the threshold.
    const size = Math.abs(row.change) + 1e-9;
    const passesRevenueTest = size >= thresholds.revenue;
    const passesNetIncomeTest = size >= thresholds.netIncome;
    return {
      ...row,
      passesRevenueTest,
      passesNetIncomeTest,
      material:
        options.rule === 'either'
          ? passesRevenueTest || passesNetIncomeTest
          : passesRevenueTest && passesNetIncomeTest,
    };
  });
  return { thresholds, rows };
}
