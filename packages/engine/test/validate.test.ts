import { describe, expect, it } from 'vitest';
import { validateScenario } from '../src/index';
import { entry, first, syntheticCopy } from './helpers';

function errorsFor(data: unknown): readonly string[] {
  const result = validateScenario(data);
  return result.ok ? [] : result.errors;
}

describe('validateScenario', () => {
  it('accepts the synthetic scenario', () => {
    const result = validateScenario(syntheticCopy());
    expect(result.ok).toBe(true);
  });

  it('rejects something that is not an object', () => {
    expect(errorsFor(null)).toEqual(['scenario must be an object']);
    expect(errorsFor([])).toEqual(['scenario must be an object']);
  });

  it('requires a source reference on every line item', () => {
    const data = syntheticCopy();
    entry(data, 'lineItems', 'revenue').sourceRef = '';
    expect(errorsFor(data)).toContainEqual(expect.stringContaining('sourceRef is required'));
  });

  it('requires a source reference on every fact', () => {
    const data = syntheticCopy();
    delete entry(data, 'facts', 'eps_basic').sourceRef;
    expect(errorsFor(data)).toContainEqual(expect.stringContaining('sourceRef is required'));
  });

  it('rejects an amount that is not a whole number of millions', () => {
    const data = syntheticCopy();
    (entry(data, 'lineItems', 'revenue').values as Record<string, number>).Y2 = 4000.5;
    expect(errorsFor(data)).toContainEqual(expect.stringContaining('must be a whole number'));
  });

  it('allows decimals in facts such as per-share figures', () => {
    const data = syntheticCopy();
    (entry(data, 'facts', 'eps_basic').values as Record<string, number>).Y2 = 4.2;
    expect(errorsFor(data)).toEqual([]);
  });

  it('rejects a value for a period the scenario does not define', () => {
    const data = syntheticCopy();
    (entry(data, 'lineItems', 'revenue').values as Record<string, number>).Y9 = 1;
    expect(errorsFor(data)).toContainEqual(expect.stringContaining('unknown period "Y9"'));
  });

  it('rejects two lines with the same id', () => {
    const data = syntheticCopy();
    entry(data, 'lineItems', 'goodwill').id = 'revenue';
    expect(errorsFor(data)).toContainEqual(expect.stringContaining('"revenue" is used twice'));
  });

  it('rejects a total that points at an id that does not exist', () => {
    const data = syntheticCopy();
    first(entry(data, 'totals', 'gross_profit').terms as { ref: string }[]).ref = 'no_such_line';
    expect(errorsFor(data)).toContainEqual(
      'total "gross_profit" refers to unknown id "no_such_line"',
    );
  });

  it('rejects totals that depend on each other in a circle', () => {
    const data = syntheticCopy();
    (entry(data, 'totals', 'gross_profit').terms as { ref: string; sign: number }[]).push({
      ref: 'net_income',
      sign: 1,
    });
    expect(errorsFor(data)).toContainEqual(expect.stringContaining('totals form a cycle'));
  });

  it('rejects a sign other than 1 or -1', () => {
    const data = syntheticCopy();
    first(entry(data, 'totals', 'gross_profit').terms as { sign: number }[]).sign = 2;
    expect(errorsFor(data)).toContainEqual(expect.stringContaining('sign must be 1 or -1'));
  });

  it('rejects a per-share check that points at a missing fact', () => {
    const data = syntheticCopy();
    first(data.perShareChecks as { denominator: string }[]).denominator = 'no_such_fact';
    expect(errorsFor(data)).toContainEqual(
      expect.stringContaining('denominator must be the id of a fact'),
    );
  });

  it('rejects a balance identity that does not name totals', () => {
    const data = syntheticCopy();
    data.balanceIdentity = {
      assets: 'goodwill',
      liabilitiesAndEquity: 'total_liabilities_and_equity',
    };
    expect(errorsFor(data)).toContainEqual('balanceIdentity.assets must be the id of a total');
  });

  it('rejects an altered notice that names an unknown period', () => {
    const data = syntheticCopy();
    data.altered = { periods: ['Y9'], notice: 'Altered.' };
    expect(errorsFor(data)).toContainEqual('altered.periods names unknown period "Y9"');
  });

  it('reports every problem, not only the first', () => {
    const data = syntheticCopy();
    entry(data, 'lineItems', 'revenue').sourceRef = '';
    entry(data, 'lineItems', 'goodwill').label = '';
    expect(errorsFor(data).length).toBe(2);
  });
});
