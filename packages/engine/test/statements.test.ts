import { describe, expect, it } from 'vitest';
import { balanceReport, computeTotals, footingReport, roundTo } from '../src/index';
import { asScenario, entry, loadScenario, syntheticCopy } from './helpers';

describe('computeTotals on the synthetic scenario', () => {
  const scenario = loadScenario('synthetic-practice-co.json');

  it('adds and subtracts line items by sign', () => {
    const totals = computeTotals(scenario, 'Y2');
    expect(totals.get('total_current_assets')).toBe(1000);
    expect(totals.get('net_property_and_equipment')).toBe(1000);
    expect(totals.get('gross_profit')).toBe(1600);
  });

  it('follows totals built on other totals', () => {
    const totals = computeTotals(scenario, 'Y2');
    expect(totals.get('total_assets')).toBe(2500);
    expect(totals.get('operating_income')).toBe(600);
    expect(totals.get('income_before_tax')).toBe(560);
    expect(totals.get('net_income')).toBe(420);
  });

  it('computes a total the statements do not print', () => {
    expect(computeTotals(scenario, 'Y2').get('total_liabilities')).toBe(1500);
    expect(computeTotals(scenario, 'Y1').get('total_liabilities')).toBe(1550);
  });

  it('computes each period on its own', () => {
    const totals = computeTotals(scenario, 'Y1');
    expect(totals.get('total_assets')).toBe(2400);
    expect(totals.get('net_income')).toBe(300);
  });

  it('leaves out a total when a line item has no value for the period', () => {
    const data = syntheticCopy();
    delete (entry(data, 'lineItems', 'cash_and_equivalents').values as Record<string, number>).Y1;
    const totals = computeTotals(asScenario(data), 'Y1');
    expect(totals.has('total_current_assets')).toBe(false);
    expect(totals.has('total_assets')).toBe(false);
    // The income statement does not depend on cash, so it still computes.
    expect(totals.get('net_income')).toBe(300);
  });

  it('carries a changed line item through every total above it', () => {
    const data = syntheticCopy();
    (entry(data, 'lineItems', 'revenue').values as Record<string, number>).Y2 = 4100;
    const totals = computeTotals(asScenario(data), 'Y2');
    expect(totals.get('gross_profit')).toBe(1700);
    expect(totals.get('operating_income')).toBe(700);
    expect(totals.get('net_income')).toBe(520);
  });

  it('handles a line item with a negative value', () => {
    const data = syntheticCopy();
    (entry(data, 'lineItems', 'income_tax_expense').values as Record<string, number>).Y2 = -40;
    expect(computeTotals(asScenario(data), 'Y2').get('net_income')).toBe(600);
  });
});

describe('footingReport on the synthetic scenario', () => {
  const scenario = loadScenario('synthetic-practice-co.json');

  it('checks every printed total and per-share figure in every period', () => {
    const rows = footingReport(scenario);
    // 10 printed totals and 2 per-share figures, 2 periods each.
    expect(rows.length).toBe(24);
    expect(rows.filter((row) => !row.matches)).toEqual([]);
  });

  it('does not check a total that has no printed figure', () => {
    const rows = footingReport(scenario);
    expect(rows.some((row) => row.check === 'total_liabilities')).toBe(false);
  });

  it('reports a wrong line item on the total it feeds, and judges totals above against printed figures', () => {
    const data = syntheticCopy();
    (entry(data, 'lineItems', 'revenue').values as Record<string, number>).Y2 = 4001;
    const failures = footingReport(asScenario(data)).filter((row) => !row.matches);
    expect(failures).toEqual([
      {
        check: 'gross_profit',
        kind: 'total',
        period: 'Y2',
        printed: 1600,
        computed: 1601,
        matches: false,
      },
    ]);
  });

  it('reports a printed subtotal that does not add up', () => {
    const data = syntheticCopy();
    (entry(data, 'totals', 'income_before_tax').printed as Record<string, number>).Y2 = 570;
    const failures = footingReport(asScenario(data)).filter((row) => !row.matches);
    expect(failures.map((row) => [row.check, row.printed, row.computed])).toEqual([
      ['income_before_tax', 570, 560],
      // Net income is judged against the printed 570, so it no longer foots either.
      ['net_income', 420, 430],
    ]);
  });

  it('reports a per-share figure that does not match its quotient', () => {
    const data = syntheticCopy();
    (entry(data, 'facts', 'eps_diluted').values as Record<string, number>).Y1 = 2.85;
    const failures = footingReport(asScenario(data)).filter((row) => !row.matches);
    expect(failures).toEqual([
      {
        check: 'eps_diluted',
        kind: 'per_share',
        period: 'Y1',
        printed: 2.85,
        computed: 2.86,
        matches: false,
      },
    ]);
  });
});

describe('balanceReport on the synthetic scenario', () => {
  it('balances in every period', () => {
    const rows = balanceReport(loadScenario('synthetic-practice-co.json'));
    expect(rows).toEqual([
      { period: 'Y2', assets: 2500, liabilitiesAndEquity: 2500, balanced: true },
      { period: 'Y1', assets: 2400, liabilitiesAndEquity: 2400, balanced: true },
    ]);
  });

  it('shows the gap when one side changes', () => {
    const data = syntheticCopy();
    (entry(data, 'lineItems', 'cash_and_equivalents').values as Record<string, number>).Y2 = 310;
    const row = balanceReport(asScenario(data)).find((candidate) => candidate.period === 'Y2');
    expect(row).toEqual({
      period: 'Y2',
      assets: 2510,
      liabilitiesAndEquity: 2500,
      balanced: false,
    });
  });
});

describe('roundTo', () => {
  it('rounds to the given number of decimals', () => {
    expect(roundTo(2.857142, 2)).toBe(2.86);
    expect(roundTo(4.2, 2)).toBe(4.2);
    expect(roundTo(1234.5, 0)).toBe(1235);
  });

  it('rounds a half away from zero, in both directions', () => {
    expect(roundTo(1.005, 2)).toBe(1.01);
    expect(roundTo(0.125, 2)).toBe(0.13);
    expect(roundTo(-1.005, 2)).toBe(-1.01);
    expect(roundTo(-0.5, 0)).toBe(-1);
  });
});
