import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MATERIALITY,
  differenceReport,
  materialityReport,
  statementRows,
} from '../src/index';
import type { DifferenceRow, MaterialityRow } from '../src/index';
import { asScenario, entry, loadScenario, syntheticCopy } from './helpers';

function rowOf<T extends { id: string }>(rows: readonly T[], id: string): T {
  const found = rows.find((row) => row.id === id);
  if (found === undefined) throw new Error(`no row "${id}"`);
  return found;
}

describe('statementRows', () => {
  it('puts each total directly after the last row it adds up', () => {
    const rows = statementRows(loadScenario('synthetic-practice-co.json'));
    expect(rows.map((row) => row.id)).toEqual([
      'cash_and_equivalents',
      'receivables_net',
      'inventories',
      'other_current_assets',
      'total_current_assets',
      'gross_property_and_equipment',
      'accumulated_depreciation',
      'net_property_and_equipment',
      'goodwill',
      'other_assets',
      'total_assets',
      'accounts_payable',
      'accrued_liabilities',
      'short_term_debt',
      'total_current_liabilities',
      'long_term_debt',
      'other_long_term_liabilities',
      'total_liabilities',
      'common_stock',
      'additional_paid_in_capital',
      'retained_earnings',
      'total_equity',
      'total_liabilities_and_equity',
      'revenue',
      'cost_of_sales',
      'gross_profit',
      'selling_general_and_administrative',
      'operating_income',
      'interest_income',
      'interest_expense',
      'income_before_tax',
      'income_tax_expense',
      'net_income',
    ]);
  });

  it('marks lines, totals, and totals the statements do not print', () => {
    const rows = statementRows(loadScenario('synthetic-practice-co.json'));
    expect(rowOf(rows, 'revenue')).toMatchObject({ kind: 'line', printed: true });
    expect(rowOf(rows, 'gross_profit')).toMatchObject({ kind: 'total', printed: true });
    expect(rowOf(rows, 'total_liabilities')).toMatchObject({ kind: 'total', printed: false });
  });

  it('follows the layout of the Best Buy balance sheet and statement of earnings', () => {
    const rows = statementRows(loadScenario('best-buy-fy2021.json'));
    expect(rows.map((row) => row.id)).toEqual([
      'cash_and_equivalents',
      'receivables_net',
      'inventories',
      'other_current_assets',
      'total_current_assets',
      'land_and_buildings',
      'leasehold_improvements',
      'fixtures_and_equipment',
      'property_under_finance_leases',
      'gross_property_and_equipment',
      'accumulated_depreciation',
      'net_property_and_equipment',
      'operating_lease_assets',
      'goodwill',
      'other_assets',
      'total_assets',
      'accounts_payable',
      'unredeemed_gift_card_liabilities',
      'deferred_revenue',
      'accrued_compensation',
      'accrued_liabilities',
      'short_term_debt',
      'current_operating_lease_liabilities',
      'current_portion_of_long_term_debt',
      'total_current_liabilities',
      'long_term_operating_lease_liabilities',
      'long_term_liabilities',
      'long_term_debt',
      'total_liabilities',
      'preferred_stock',
      'common_stock',
      'additional_paid_in_capital',
      'retained_earnings',
      'accumulated_other_comprehensive_income',
      'total_equity',
      'total_liabilities_and_equity',
      'revenue',
      'cost_of_sales',
      'gross_profit',
      'selling_general_and_administrative',
      'restructuring_charges',
      'operating_income',
      'gain_on_sale_of_investments',
      'investment_income_and_other',
      'interest_expense',
      'income_before_tax',
      'income_tax_expense',
      'net_income',
    ]);
  });

  it('follows the layout of the Nvidia income statement, where totals add up other totals', () => {
    const rows = statementRows(loadScenario('nvidia-fy2021.json'));
    const income = rows.filter((row) => row.statement === 'income_statement').map((row) => row.id);
    expect(income).toEqual([
      'revenue',
      'cost_of_sales',
      'gross_profit',
      'research_and_development',
      'selling_general_and_administrative',
      'total_operating_expenses',
      'operating_income',
      'interest_income',
      'interest_expense',
      'other_net',
      'other_income_expense_net',
      'income_before_tax',
      'income_tax_expense',
      'net_income',
    ]);
  });

  it('gives every scenario one row per line item and total', () => {
    for (const fileName of [
      'best-buy-fy2021.json',
      'best-buy-fy2022-altered.json',
      'nvidia-fy2021.json',
    ]) {
      const scenario = loadScenario(fileName);
      const rows = statementRows(scenario);
      expect(rows.length).toBe(scenario.lineItems.length + scenario.totals.length);
      expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
    }
  });
});

describe('differenceReport on the synthetic scenario', () => {
  const scenario = loadScenario('synthetic-practice-co.json');
  const report: DifferenceRow[] = differenceReport(scenario, 'Y2', 'Y1');

  it('has a row for every line and total, in statement order', () => {
    expect(report.map((row) => row.id)).toEqual(statementRows(scenario).map((row) => row.id));
  });

  it('computes the change and the percent change from the prior year', () => {
    expect(rowOf(report, 'cash_and_equivalents')).toMatchObject({
      current: 300,
      prior: 250,
      change: 50,
      percentChange: 20,
    });
    const debt = rowOf(report, 'short_term_debt');
    expect(debt.change).toBe(-30);
    expect(debt.percentChange).toBeCloseTo((-30 / 130) * 100, 10);
    expect(rowOf(report, 'goodwill')).toMatchObject({ change: 0, percentChange: 0 });
  });

  it('includes totals, with the computed figure where none is printed', () => {
    expect(rowOf(report, 'net_income')).toMatchObject({ current: 420, prior: 300, change: 120 });
    expect(rowOf(report, 'total_liabilities')).toMatchObject({
      current: 1500,
      prior: 1550,
      change: -50,
      printed: false,
    });
  });

  it('shows a total as the statements print it, even if it does not add up', () => {
    const data = syntheticCopy();
    (entry(data, 'totals', 'income_before_tax').printed as Record<string, number>).Y2 = 570;
    const changed = differenceReport(asScenario(data), 'Y2', 'Y1');
    expect(rowOf(changed, 'income_before_tax')).toMatchObject({ current: 570, change: 170 });
  });

  it('has no percent change when the prior figure is zero', () => {
    const data = syntheticCopy();
    (entry(data, 'lineItems', 'goodwill').values as Record<string, number>).Y1 = 0;
    const changed = differenceReport(asScenario(data), 'Y2', 'Y1');
    expect(rowOf(changed, 'goodwill')).toMatchObject({ change: 200, percentChange: undefined });
  });

  it('leaves out a row that has no figure in one of the periods', () => {
    const data = syntheticCopy();
    delete (entry(data, 'lineItems', 'goodwill').values as Record<string, number>).Y1;
    const changed = differenceReport(asScenario(data), 'Y2', 'Y1');
    expect(changed.some((row) => row.id === 'goodwill')).toBe(false);
    expect(changed.some((row) => row.id === 'other_assets')).toBe(true);
  });
});

describe('materialityReport on the synthetic scenario', () => {
  const scenario = loadScenario('synthetic-practice-co.json');

  it('defaults to 1% of revenue and 10% of net income, on the prior year, either test', () => {
    expect(DEFAULT_MATERIALITY).toEqual({
      revenueShare: 0.01,
      netIncomeShare: 0.1,
      base: 'prior',
      rule: 'either',
    });
  });

  it('measures the thresholds on the prior year by default', () => {
    const { thresholds } = materialityReport(scenario, 'Y2', 'Y1');
    expect(thresholds.basePeriod).toBe('Y1');
    expect(thresholds.revenue).toBeCloseTo(36, 10);
    expect(thresholds.netIncome).toBeCloseTo(30, 10);
  });

  it('judges each change against both thresholds', () => {
    const rows: readonly MaterialityRow[] = materialityReport(scenario, 'Y2', 'Y1').rows;
    // +50 passes both 36 and 30.
    expect(rowOf(rows, 'cash_and_equivalents')).toMatchObject({
      passesRevenueTest: true,
      passesNetIncomeTest: true,
      material: true,
    });
    // +20 passes neither.
    expect(rowOf(rows, 'receivables_net')).toMatchObject({
      passesRevenueTest: false,
      passesNetIncomeTest: false,
      material: false,
    });
    // -30 is exactly 10% of net income, which counts, and is under 1% of revenue.
    expect(rowOf(rows, 'short_term_debt')).toMatchObject({
      passesRevenueTest: false,
      passesNetIncomeTest: true,
      material: true,
    });
  });

  it('lists exactly the material rows', () => {
    const rows = materialityReport(scenario, 'Y2', 'Y1').rows;
    expect(rows.filter((row) => row.material && row.kind === 'line').map((row) => row.id)).toEqual([
      'cash_and_equivalents',
      'inventories',
      'gross_property_and_equipment',
      'accumulated_depreciation',
      'short_term_debt',
      'long_term_debt',
      'retained_earnings',
      'revenue',
      'cost_of_sales',
      'selling_general_and_administrative',
      'income_tax_expense',
    ]);
  });

  it('can require both tests', () => {
    const rows = materialityReport(scenario, 'Y2', 'Y1', {
      ...DEFAULT_MATERIALITY,
      rule: 'both',
    }).rows;
    expect(rowOf(rows, 'short_term_debt').material).toBe(false);
    expect(rowOf(rows, 'cash_and_equivalents').material).toBe(true);
  });

  it('can measure the thresholds on the current year', () => {
    const report = materialityReport(scenario, 'Y2', 'Y1', {
      ...DEFAULT_MATERIALITY,
      base: 'current',
    });
    expect(report.thresholds.basePeriod).toBe('Y2');
    expect(report.thresholds.revenue).toBeCloseTo(40, 10);
    expect(report.thresholds.netIncome).toBeCloseTo(42, 10);
    // +40 is exactly 1% of revenue, which counts, and is under 10% of net income.
    expect(rowOf(report.rows, 'inventories')).toMatchObject({
      passesRevenueTest: true,
      passesNetIncomeTest: false,
      material: true,
    });
  });

  it('fails clearly when the base year has no revenue', () => {
    const data = syntheticCopy();
    delete (entry(data, 'lineItems', 'revenue').values as Record<string, number>).Y1;
    delete (entry(data, 'totals', 'gross_profit').printed as Record<string, number>).Y1;
    expect(() => materialityReport(asScenario(data), 'Y2', 'Y1')).toThrow(/no revenue/);
  });
});
