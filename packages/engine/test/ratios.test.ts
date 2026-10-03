import { describe, expect, it } from 'vitest';
import { checkCitation, checkRatioAnswer, computeRatios, RATIOS } from '../src/index';
import type { DefinitionResult, RatioResult, Scenario } from '../src/index';
import { asScenario, entry, loadScenario, syntheticCopy } from './helpers';

function ratioOf(results: readonly RatioResult[], id: string): RatioResult {
  const found = results.find((result) => result.id === id);
  if (found === undefined) throw new Error(`no ratio "${id}"`);
  return found;
}

function definitionOf(result: RatioResult, id = 'key'): DefinitionResult {
  const found = result.definitions.find((definition) => definition.id === id);
  if (found === undefined) throw new Error(`no definition "${id}" on ratio "${result.id}"`);
  return found;
}

/** The value of one definition, failing the test if it is unavailable. */
function valueOf(results: readonly RatioResult[], id: string, definition = 'key'): number {
  const found = definitionOf(ratioOf(results, id), definition);
  if (!found.available) throw new Error(`ratio "${id}" / "${definition}" is unavailable`);
  return found.value;
}

function ratiosFor(mutate: (data: Record<string, unknown>) => void, period = 'Y2'): RatioResult[] {
  const data = syntheticCopy();
  mutate(data);
  return computeRatios(asScenario(data), period);
}

function addFact(data: Record<string, unknown>, id: string, unit: string, value: number): void {
  (data.facts as unknown[]).push({
    id,
    label: id,
    unit,
    values: { Y2: value },
    sourceRef: 'Synthetic. Added by a test.',
  });
}

describe('RATIOS', () => {
  it('lists the 20 ratios of Exhibit 5 in the exhibit order', () => {
    expect(RATIOS.map((ratio) => ratio.id)).toEqual([
      'net_working_capital',
      'current_ratio',
      'quick_ratio',
      'receivables_turnover',
      'average_collection_period',
      'inventory_turnover',
      'average_age_of_inventory',
      'total_asset_turnover',
      'debt_ratio',
      'debt_to_equity',
      'times_interest_earned',
      'gross_profit_margin',
      'profit_margin',
      'return_on_total_assets',
      'return_on_common_equity',
      'earnings_per_share',
      'price_earnings',
      'book_value_per_share',
      'dividend_yield',
      'dividend_payout',
    ]);
  });

  it('groups them as the exhibit does', () => {
    const count = (group: string): number => RATIOS.filter((ratio) => ratio.group === group).length;
    expect(count('liquidity')).toBe(3);
    expect(count('activity')).toBe(5);
    expect(count('leverage')).toBe(3);
    expect(count('profitability')).toBe(4);
    expect(count('market_value')).toBe(5);
  });

  it('gives every formula a label and a unique id within its ratio', () => {
    for (const ratio of RATIOS) {
      const formulas = [ratio.key, ...ratio.variants];
      expect(ratio.key.id).toBe('key');
      expect(new Set(formulas.map((formula) => formula.id)).size).toBe(formulas.length);
      for (const formula of formulas) expect(formula.label.length).toBeGreaterThan(0);
    }
  });
});

describe('computeRatios on the synthetic scenario', () => {
  const scenario: Scenario = loadScenario('synthetic-practice-co.json');
  const results = computeRatios(scenario, 'Y2');

  it('computes the liquidity ratios', () => {
    expect(valueOf(results, 'net_working_capital')).toBe(400);
    expect(valueOf(results, 'current_ratio')).toBeCloseTo(1000 / 600, 10);
    expect(valueOf(results, 'quick_ratio')).toBeCloseTo(500 / 600, 10);
  });

  it('computes the activity ratios on two-year averages', () => {
    expect(valueOf(results, 'receivables_turnover')).toBeCloseTo(4000 / 190, 10);
    expect(valueOf(results, 'average_collection_period')).toBeCloseTo(17.3375, 10);
    expect(valueOf(results, 'inventory_turnover')).toBeCloseTo(2400 / 380, 10);
    expect(valueOf(results, 'average_age_of_inventory')).toBeCloseTo(365 / (2400 / 380), 10);
    expect(valueOf(results, 'total_asset_turnover')).toBeCloseTo(4000 / 2450, 10);
  });

  it('computes the leverage ratios', () => {
    expect(valueOf(results, 'debt_ratio')).toBeCloseTo(0.6, 10);
    expect(valueOf(results, 'debt_to_equity')).toBeCloseTo(1.5, 10);
    expect(valueOf(results, 'times_interest_earned')).toBeCloseTo(12.2, 10);
  });

  it('computes the profitability ratios in percent', () => {
    expect(valueOf(results, 'gross_profit_margin')).toBeCloseTo(40, 10);
    expect(valueOf(results, 'profit_margin')).toBeCloseTo(10.5, 10);
    expect(valueOf(results, 'return_on_total_assets')).toBeCloseTo((420 / 2450) * 100, 10);
    expect(valueOf(results, 'return_on_common_equity')).toBeCloseTo(42, 10);
  });

  it('computes the per-share ratios', () => {
    expect(valueOf(results, 'earnings_per_share')).toBeCloseTo(4.2, 10);
    expect(valueOf(results, 'book_value_per_share')).toBeCloseTo(10, 10);
    expect(valueOf(results, 'dividend_payout')).toBeCloseTo((2.7 / 4.2) * 100, 10);
  });

  it('computes the accepted variants', () => {
    expect(valueOf(results, 'debt_ratio', 'interest_bearing_debt')).toBeCloseTo(0.32, 10);
    expect(valueOf(results, 'times_interest_earned', 'operating_income')).toBeCloseTo(12, 10);
  });

  it('uses period-end shares in the EPS, P/E and payout variants', () => {
    const changed = ratiosFor((data) => {
      (entry(data, 'facts', 'shares_outstanding').values as Record<string, number>).Y2 = 105;
      addFact(data, 'market_price_per_share', 'usd_per_share', 42);
    });
    expect(valueOf(changed, 'earnings_per_share')).toBeCloseTo(4.2, 10);
    expect(valueOf(changed, 'earnings_per_share', 'period_end_shares')).toBeCloseTo(4, 10);
    expect(valueOf(changed, 'price_earnings', 'period_end_shares')).toBeCloseTo(10.5, 10);
    expect(valueOf(changed, 'dividend_payout', 'period_end_shares')).toBeCloseTo(67.5, 10);
  });

  it('puts the key definition first', () => {
    for (const result of results) expect(result.definitions[0]?.id).toBe('key');
  });

  it('does not guess a share price: P/E and dividend yield are unavailable without one', () => {
    for (const id of ['price_earnings', 'dividend_yield']) {
      expect(definitionOf(ratioOf(results, id))).toMatchObject({
        available: false,
        unavailable: { reason: 'missing_input', ids: ['market_price_per_share'] },
      });
    }
  });

  it('computes P/E and dividend yield once a share price is supplied', () => {
    const priced = ratiosFor((data) => {
      addFact(data, 'market_price_per_share', 'usd_per_share', 42);
    });
    expect(valueOf(priced, 'price_earnings')).toBeCloseTo(10, 10);
    expect(valueOf(priced, 'dividend_yield')).toBeCloseTo((2.7 / 42) * 100, 10);
  });

  it('cannot average in the earliest period, and says so', () => {
    const earliest = computeRatios(scenario, 'Y1');
    for (const id of [
      'receivables_turnover',
      'average_collection_period',
      'inventory_turnover',
      'average_age_of_inventory',
      'total_asset_turnover',
      'return_on_total_assets',
    ]) {
      expect(definitionOf(ratioOf(earliest, id))).toMatchObject({
        available: false,
        unavailable: { reason: 'no_prior_period' },
      });
    }
    expect(valueOf(earliest, 'net_working_capital')).toBe(300);
    expect(valueOf(earliest, 'profit_margin')).toBeCloseTo((300 / 3600) * 100, 10);
  });

  it('counts marketable securities in the quick ratio when the company reports them', () => {
    const withSecurities = ratiosFor((data) => {
      (data.lineItems as unknown[]).push({
        id: 'marketable_securities',
        label: 'Marketable securities',
        statement: 'balance_sheet',
        section: 'current_assets',
        normalBalance: 'debit',
        values: { Y2: 60, Y1: 60 },
        sourceRef: 'Synthetic. Added by a test.',
      });
    });
    expect(valueOf(withSecurities, 'quick_ratio')).toBeCloseTo(560 / 600, 10);
  });

  it('derives dividends per share from dividends paid when only the total is reported', () => {
    const paid = ratiosFor((data) => {
      data.facts = (data.facts as { id: string }[]).filter((f) => f.id !== 'dividends_per_share');
      addFact(data, 'dividends_paid', 'usd_millions', 270);
    });
    expect(valueOf(paid, 'dividend_payout')).toBeCloseTo((2.7 / 4.2) * 100, 10);
    const payout = definitionOf(ratioOf(paid, 'dividend_payout'));
    expect(payout.available && payout.inputs.map((input) => input.id)).toEqual([
      'dividends_paid',
      'weighted_shares_basic',
      'net_income',
    ]);
  });

  it('reports every figure it lacks when dividends are not reported at all', () => {
    const none = ratiosFor((data) => {
      data.facts = (data.facts as { id: string }[]).filter((f) => f.id !== 'dividends_per_share');
    });
    expect(definitionOf(ratioOf(none, 'dividend_payout'))).toMatchObject({
      available: false,
      unavailable: { reason: 'missing_input', ids: ['dividends_per_share', 'dividends_paid'] },
    });
  });

  it('refuses to divide by zero', () => {
    const noInterest = ratiosFor((data) => {
      (entry(data, 'lineItems', 'interest_expense').values as Record<string, number>).Y2 = 0;
    });
    expect(definitionOf(ratioOf(noInterest, 'times_interest_earned'))).toMatchObject({
      available: false,
      unavailable: { reason: 'division_by_zero' },
    });
  });

  it('lists the figures each formula uses', () => {
    const inputs = (id: string, definition = 'key'): unknown => {
      const found = definitionOf(ratioOf(results, id), definition);
      return found.available ? found.inputs : undefined;
    };
    expect(inputs('current_ratio')).toEqual([
      { id: 'total_current_assets', period: 'Y2' },
      { id: 'total_current_liabilities', period: 'Y2' },
    ]);
    expect(inputs('receivables_turnover')).toEqual([
      { id: 'revenue', period: 'Y2' },
      { id: 'receivables_net', period: 'Y2' },
      { id: 'receivables_net', period: 'Y1' },
    ]);
    // A ratio built on another ratio uses that ratio's figures.
    expect(inputs('average_collection_period')).toEqual(inputs('receivables_turnover'));
    // A figure used twice is listed once.
    expect(inputs('times_interest_earned')).toEqual([
      { id: 'income_before_tax', period: 'Y2' },
      { id: 'interest_expense', period: 'Y2' },
    ]);
    // A line the company does not report is not listed.
    expect(inputs('quick_ratio')).toEqual([
      { id: 'cash_and_equivalents', period: 'Y2' },
      { id: 'receivables_net', period: 'Y2' },
      { id: 'total_current_liabilities', period: 'Y2' },
    ]);
  });
});

describe('checkRatioAnswer', () => {
  const results = computeRatios(loadScenario('synthetic-practice-co.json'), 'Y2');

  it('accepts the exact value and names the key definition', () => {
    const check = checkRatioAnswer(ratioOf(results, 'debt_to_equity'), 1.5);
    expect(check).toEqual({ status: 'match', definition: 'key' });
  });

  it('accepts a rounded value within 0.01', () => {
    // Current ratio is 1.6667.
    expect(checkRatioAnswer(ratioOf(results, 'current_ratio'), 1.67).status).toBe('match');
    expect(checkRatioAnswer(ratioOf(results, 'current_ratio'), 1.66).status).toBe('match');
    expect(checkRatioAnswer(ratioOf(results, 'current_ratio'), 1.7).status).toBe('no_match');
  });

  it('accepts a value within 1% when that is wider than 0.01', () => {
    // Net working capital is 400, so 1% is 4.
    expect(checkRatioAnswer(ratioOf(results, 'net_working_capital'), 404).status).toBe('match');
    expect(checkRatioAnswer(ratioOf(results, 'net_working_capital'), 396).status).toBe('match');
    expect(checkRatioAnswer(ratioOf(results, 'net_working_capital'), 405).status).toBe('no_match');
  });

  it('accepts an accepted variant and says which one', () => {
    expect(checkRatioAnswer(ratioOf(results, 'debt_ratio'), 0.32)).toEqual({
      status: 'match',
      definition: 'interest_bearing_debt',
    });
    expect(checkRatioAnswer(ratioOf(results, 'debt_ratio'), 0.6)).toEqual({
      status: 'match',
      definition: 'key',
    });
  });

  it('names the closest definition when a value is within tolerance of two', () => {
    // Times interest earned is 12.2 on the key and 12 on the variant. 1% of each is about 0.12.
    const ratio = ratioOf(results, 'times_interest_earned');
    expect(checkRatioAnswer(ratio, 12.09)).toEqual({
      status: 'match',
      definition: 'operating_income',
    });
    expect(checkRatioAnswer(ratio, 12.11)).toEqual({ status: 'match', definition: 'key' });
  });

  it('prefers the key when two definitions give the same value', () => {
    // Weighted and period-end shares are both 100 in the synthetic scenario.
    expect(checkRatioAnswer(ratioOf(results, 'earnings_per_share'), 4.2)).toEqual({
      status: 'match',
      definition: 'key',
    });
  });

  it('reads a percent ratio entered as a fraction', () => {
    const margin = ratioOf(results, 'gross_profit_margin');
    expect(checkRatioAnswer(margin, 40).status).toBe('match');
    expect(checkRatioAnswer(margin, 0.4).status).toBe('match');
    expect(checkRatioAnswer(margin, 4).status).toBe('no_match');
  });

  it('does not read other units as fractions', () => {
    expect(checkRatioAnswer(ratioOf(results, 'debt_to_equity'), 0.015).status).toBe('no_match');
  });

  it('rejects a value that is not a number', () => {
    expect(checkRatioAnswer(ratioOf(results, 'current_ratio'), Number.NaN).status).toBe('no_match');
    expect(checkRatioAnswer(ratioOf(results, 'current_ratio'), Infinity).status).toBe('no_match');
  });

  it('has nothing to check against when the ratio is unavailable', () => {
    expect(checkRatioAnswer(ratioOf(results, 'price_earnings'), 10)).toEqual({
      status: 'unavailable',
    });
  });
});

describe('checkCitation', () => {
  const results = computeRatios(loadScenario('synthetic-practice-co.json'), 'Y2');

  it('accepts exactly the figures the key formula uses, in any order', () => {
    const check = checkCitation(ratioOf(results, 'receivables_turnover'), [
      { id: 'receivables_net', period: 'Y1' },
      { id: 'revenue', period: 'Y2' },
      { id: 'receivables_net', period: 'Y2' },
      { id: 'revenue', period: 'Y2' },
    ]);
    expect(check).toEqual({ status: 'match', definition: 'key' });
  });

  it('accepts the figures of an accepted variant', () => {
    const check = checkCitation(ratioOf(results, 'times_interest_earned'), [
      { id: 'operating_income', period: 'Y2' },
      { id: 'interest_expense', period: 'Y2' },
    ]);
    expect(check).toEqual({ status: 'match', definition: 'operating_income' });
  });

  it('says what is missing and what does not belong, against the key formula', () => {
    const check = checkCitation(ratioOf(results, 'receivables_turnover'), [
      { id: 'revenue', period: 'Y2' },
      { id: 'receivables_net', period: 'Y2' },
      { id: 'inventories', period: 'Y2' },
    ]);
    expect(check).toEqual({
      status: 'no_match',
      missing: [{ id: 'receivables_net', period: 'Y1' }],
      extra: [{ id: 'inventories', period: 'Y2' }],
    });
  });

  it('treats the same line in another period as a different figure', () => {
    const check = checkCitation(ratioOf(results, 'current_ratio'), [
      { id: 'total_current_assets', period: 'Y1' },
      { id: 'total_current_liabilities', period: 'Y2' },
    ]);
    expect(check.status).toBe('no_match');
  });

  it('has nothing to check against when the ratio is unavailable', () => {
    expect(checkCitation(ratioOf(results, 'dividend_yield'), [])).toEqual({
      status: 'unavailable',
    });
  });
});

describe('ratios on the exhibit scenarios', () => {
  // Availability only. The values are expected answers, so they are checked in the keys repo.
  it.each(['best-buy-fy2021.json', 'nvidia-fy2021.json'])(
    '%s has every figure the ratios need, except a share price',
    (fileName) => {
      const results = computeRatios(loadScenario(fileName), 'FY2021');
      const unavailable = results
        .filter((result) => !definitionOf(result).available)
        .map((result) => result.id);
      expect(unavailable).toEqual(['price_earnings', 'dividend_yield']);
      for (const result of results) {
        for (const definition of result.definitions) {
          if (definition.available) continue;
          expect(definition.unavailable).toEqual({
            reason: 'missing_input',
            ids: ['market_price_per_share'],
          });
        }
      }
    },
  );
});
