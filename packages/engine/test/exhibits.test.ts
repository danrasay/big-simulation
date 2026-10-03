/**
 * Data-integrity checks on the scenario files.
 *
 * These confirm the transcription: the files are well formed, every total and
 * per-share figure printed in an exhibit equals what its own components
 * produce, and each balance sheet balances.
 *
 * Periods a scenario marks as altered are left out. Their figures were
 * invented for an exercise, and whether they add up is for students to work
 * out, so this repository makes no claim about them either way.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { balanceReport, footingReport, validateScenario } from '../src/index';
import type { Scenario } from '../src/index';
import { loadScenario, readScenarioFile, repoRoot, scenarioFileNames } from './helpers';

/**
 * Footing checks each file must produce on its unaltered periods, so a check
 * cannot silently stop running.
 */
const EXPECTED_CHECKS: Record<string, number> = {
  // 7 printed balance sheet totals x 2 dates, 4 income statement totals x 3 years, 2 EPS figures x 3 years.
  'best-buy-fy2021.json': 32,
  // The same statements with the altered year left out: 7 x 1, 4 x 2, 2 x 2.
  'best-buy-fy2022-altered.json': 19,
  // 6 printed balance sheet totals x 2 dates, 6 income statement totals x 3 years, 2 EPS figures x 3 years.
  'nvidia-fy2021.json': 36,
  // 6 printed balance sheet totals x 2 dates, 4 income statement totals x 2 years, 2 EPS figures x 2 years.
  'synthetic-practice-co.json': 24,
};

/** Balance sheet dates each file must produce on its unaltered periods. */
const EXPECTED_BALANCE_DATES: Record<string, number> = {
  'best-buy-fy2021.json': 2,
  'best-buy-fy2022-altered.json': 1,
  'nvidia-fy2021.json': 2,
  'synthetic-practice-co.json': 2,
};

describe('scenario files', () => {
  it('are the four this phase defines', () => {
    expect(scenarioFileNames()).toEqual(Object.keys(EXPECTED_CHECKS).sort());
  });

  it.each(scenarioFileNames())('%s is a valid scenario', (fileName) => {
    const result = validateScenario(readScenarioFile(fileName));
    expect(result.ok ? [] : result.errors).toEqual([]);
  });

  it.each(scenarioFileNames())('%s has an id that matches its file name', (fileName) => {
    expect(loadScenario(fileName).id).toBe(fileName.replace(/\.json$/, ''));
  });
});

describe.each(scenarioFileNames())('%s', (fileName) => {
  const scenario: Scenario = loadScenario(fileName);
  const altered = new Set(scenario.altered?.periods ?? []);
  const rows = footingReport(scenario).filter((row) => !altered.has(row.period));

  it('runs the expected number of footing checks on its unaltered periods', () => {
    expect(rows.length).toBe(EXPECTED_CHECKS[fileName]);
  });

  it('foots: every printed total and per-share figure equals what its components produce', () => {
    expect(rows.filter((row) => !row.matches)).toEqual([]);
  });

  it('balances: assets equal liabilities plus equity at every unaltered balance sheet date', () => {
    const report = balanceReport(scenario).filter((row) => !altered.has(row.period));
    expect(report.length).toBe(EXPECTED_BALANCE_DATES[fileName]);
    expect(report.filter((row) => !row.balanced)).toEqual([]);
  });

  it('points at a source document that exists', () => {
    expect(existsSync(join(repoRoot, scenario.source.file))).toBe(true);
  });

  it('cites its own exhibit on every number', () => {
    const prefix = scenario.kind === 'synthetic' ? 'Synthetic.' : `${scenario.source.exhibit},`;
    const lines = [...scenario.lineItems, ...scenario.totals, ...scenario.facts];
    const uncited = lines.filter((line) => !line.sourceRef.startsWith(prefix));
    expect(uncited.map((line) => line.id)).toEqual([]);
  });
});

describe('exhibit scenarios together', () => {
  const exhibit1 = loadScenario('best-buy-fy2021.json');
  const exhibit4 = loadScenario('best-buy-fy2022-altered.json');

  it('mark only Exhibit 4 as altered, with a notice', () => {
    expect(exhibit1.altered).toBeUndefined();
    expect(loadScenario('nvidia-fy2021.json').altered).toBeUndefined();
    expect(loadScenario('synthetic-practice-co.json').altered).toBeUndefined();
    expect(exhibit4.altered?.periods).toEqual(['FY2022A']);
    expect(exhibit4.altered?.notice).toContain("not Best Buy's reported results");
  });

  it('agree on fiscal 2021 and fiscal 2019, the years Exhibits 1 and 4 both print', () => {
    const differences: string[] = [];
    let compared = 0;
    const compare = (
      id: string,
      period: string,
      a: number | undefined,
      b: number | undefined,
    ): void => {
      if (a === undefined || b === undefined) return;
      compared += 1;
      if (a !== b) {
        differences.push(`${id} ${period}: Exhibit 1 has ${String(a)}, Exhibit 4 has ${String(b)}`);
      }
    };
    for (const period of ['FY2021', 'FY2019']) {
      for (const item of exhibit4.lineItems) {
        const other = exhibit1.lineItems.find((candidate) => candidate.id === item.id);
        compare(item.id, period, other?.values[period], item.values[period]);
      }
      for (const total of exhibit4.totals) {
        const other = exhibit1.totals.find((candidate) => candidate.id === total.id);
        compare(total.id, period, other?.printed?.[period], total.printed?.[period]);
      }
      for (const fact of exhibit4.facts) {
        const other = exhibit1.facts.find((candidate) => candidate.id === fact.id);
        compare(fact.id, period, other?.values[period], fact.values[period]);
      }
    }
    expect(differences).toEqual([]);
    // 36 line items and 11 printed totals for fiscal 2021, the income statement
    // (8 lines, 4 totals) for fiscal 2019, and 4 per-share facts in each year.
    expect(compared).toBe(67);
  });
});
