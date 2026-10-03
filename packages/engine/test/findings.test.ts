import { describe, expect, it } from 'vitest';
import {
  coverage,
  FINDING_CATEGORIES,
  findingsKeyProblems,
  flagIsMaterial,
  materialityReport,
  validateFlag,
} from '../src/index';
import type { FindingsKey, Flag } from '../src/index';
import { loadScenario } from './helpers';

const scenario = loadScenario('synthetic-practice-co.json');

/** A made-up key for the synthetic scenario. Real keys live outside this repository. */
const key: FindingsKey = {
  scenario: 'synthetic-practice-co',
  findings: [
    { id: 'cash-and-receivables', lineItems: ['cash_and_equivalents', 'receivables_net'] },
    { id: 'inventory', lineItems: ['inventories'] },
    { id: 'margin', lineItems: ['revenue', 'cost_of_sales', 'gross_profit'] },
  ],
};

const flag = (lineItems: string[], category: Flag['category'] = 'unexplained'): Flag => ({
  lineItems,
  category,
  evidence: 'Evidence written by a test.',
});

describe('FINDING_CATEGORIES', () => {
  it('are the six questions of the project description, a to f', () => {
    expect(FINDING_CATEGORIES.map((category) => category.question)).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
      'f',
    ]);
    expect(FINDING_CATEGORIES.map((category) => category.id)).toEqual([
      'not_gaap',
      'misleading',
      'missing_footnote',
      'unexplained',
      'information_needed',
      'other',
    ]);
  });
});

describe('validateFlag', () => {
  it('accepts a flag about a line item', () => {
    const result = validateFlag(scenario, {
      lineItems: ['inventories'],
      category: 'missing_footnote',
      evidence: '  Inventories rose with no note on the method.  ',
    });
    expect(result).toEqual({
      ok: true,
      flag: {
        lineItems: ['inventories'],
        category: 'missing_footnote',
        evidence: 'Inventories rose with no note on the method.',
      },
    });
  });

  it('accepts a flag about a total, and drops repeated lines', () => {
    const result = validateFlag(scenario, {
      lineItems: ['gross_profit', 'revenue', 'gross_profit'],
      category: 'misleading',
      evidence: 'Margin moved.',
    });
    expect(result.ok && result.flag.lineItems).toEqual(['gross_profit', 'revenue']);
  });

  it('rejects a flag about a line that is not in the scenario', () => {
    const result = validateFlag(scenario, {
      lineItems: ['no_such_line'],
      category: 'other',
      evidence: 'x',
    });
    expect(result).toEqual({ ok: false, errors: ['lineItems names unknown line "no_such_line"'] });
  });

  it('rejects a flag with no line items, an unknown category or no evidence', () => {
    const result = validateFlag(scenario, { lineItems: [], category: 'fraud', evidence: '   ' });
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors).toEqual([
      'lineItems must name at least one line item',
      'category must be one of not_gaap, misleading, missing_footnote, unexplained, information_needed, other',
      'evidence is required',
    ]);
  });

  it('rejects something that is not an object', () => {
    expect(validateFlag(scenario, 'inventories')).toEqual({
      ok: false,
      errors: ['flag must be an object'],
    });
  });
});

describe('coverage', () => {
  it('covers a finding when any flag cites any of its rows', () => {
    const report = coverage(key, [
      flag(['receivables_net']),
      flag(['gross_profit', 'goodwill']),
      flag(['goodwill']),
    ]);
    expect(report.findings).toEqual([
      { id: 'cash-and-receivables', covered: true, flags: [0] },
      { id: 'inventory', covered: false, flags: [] },
      { id: 'margin', covered: true, flags: [1] },
    ]);
    expect(report.coveredCount).toBe(2);
    expect(report.total).toBe(3);
  });

  it('lists flags that reach nothing in the key, for the instructor to judge', () => {
    const report = coverage(key, [
      flag(['receivables_net']),
      flag(['gross_profit', 'goodwill']),
      flag(['goodwill']),
    ]);
    expect(report.flagsOutsideKey).toEqual([2]);
  });

  it('lets several flags reach one finding, and one flag reach several findings', () => {
    const report = coverage(key, [
      flag(['cash_and_equivalents']),
      flag(['receivables_net', 'inventories']),
    ]);
    expect(report.findings).toEqual([
      { id: 'cash-and-receivables', covered: true, flags: [0, 1] },
      { id: 'inventory', covered: true, flags: [1] },
      { id: 'margin', covered: false, flags: [] },
    ]);
    expect(report.flagsOutsideKey).toEqual([]);
  });

  it('covers nothing when there are no flags', () => {
    const report = coverage(key, []);
    expect(report.coveredCount).toBe(0);
    expect(report.total).toBe(3);
  });

  it('does not depend on the category a flag was filed under', () => {
    const a = coverage(key, [flag(['inventories'], 'not_gaap')]);
    const b = coverage(key, [flag(['inventories'], 'other')]);
    expect(a).toEqual(b);
  });
});

describe('flagIsMaterial', () => {
  const rows = materialityReport(scenario, 'Y2', 'Y1').rows;

  it('is true when the flag cites a row whose change is material', () => {
    expect(flagIsMaterial(flag(['cash_and_equivalents']), rows)).toBe(true);
    expect(flagIsMaterial(flag(['receivables_net', 'inventories']), rows)).toBe(true);
  });

  it('is false when every cited row is below the thresholds', () => {
    expect(flagIsMaterial(flag(['receivables_net']), rows)).toBe(false);
    expect(flagIsMaterial(flag(['receivables_net', 'goodwill']), rows)).toBe(false);
  });
});

describe('findingsKeyProblems', () => {
  it('finds nothing wrong with a key whose rows exist', () => {
    expect(findingsKeyProblems(scenario, key)).toEqual([]);
  });

  it('reports a key for another scenario, unknown rows, repeats and empty findings', () => {
    const broken: FindingsKey = {
      scenario: 'some-other-scenario',
      findings: [
        { id: 'one', lineItems: ['no_such_line'] },
        { id: 'one', lineItems: ['inventories'] },
        { id: 'two', lineItems: [] },
      ],
    };
    expect(findingsKeyProblems(scenario, broken)).toEqual([
      'key is for scenario "some-other-scenario", not "synthetic-practice-co"',
      'finding "one" names unknown line "no_such_line"',
      'finding "one" appears twice',
      'finding "two" names no rows',
    ]);
  });
});
