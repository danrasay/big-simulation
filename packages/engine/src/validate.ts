import type { Scenario } from './model';

export type ValidationResult =
  | { readonly ok: true; readonly scenario: Scenario }
  | { readonly ok: false; readonly errors: readonly string[] };

type Json = Record<string, unknown>;

const STATEMENTS = ['balance_sheet', 'income_statement'];
const BALANCES = ['debit', 'credit'];
const FACT_UNITS = ['usd_millions', 'usd_per_share', 'shares_millions'];
const ID_PATTERN = /^[a-z][a-z0-9_]*$/;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Checks that untrusted data is a well-formed scenario: the right shape,
 * unique ids, whole-number amounts, formulas that only point at things that
 * exist, and no formula that depends on itself.
 *
 * It does not check the arithmetic. That is `footingReport`.
 */
export function validateScenario(input: unknown): ValidationResult {
  const errors: string[] = [];
  const fail = (message: string): void => {
    errors.push(message);
  };

  if (!isObject(input)) {
    return { ok: false, errors: ['scenario must be an object'] };
  }

  if (input.schemaVersion !== 1) fail('schemaVersion must be 1');
  if (!isText(input.id)) fail('id is required');
  if (typeof input.version !== 'number' || !Number.isInteger(input.version) || input.version < 1) {
    fail('version must be a positive whole number');
  }
  if (!isText(input.title)) fail('title is required');
  if (!isText(input.company)) fail('company is required');
  if (input.kind !== 'exhibit' && input.kind !== 'synthetic') {
    fail('kind must be "exhibit" or "synthetic"');
  }
  if (input.unit !== 'USD millions') fail('unit must be "USD millions"');

  if (!isObject(input.source)) {
    fail('source is required');
  } else {
    for (const key of ['exhibit', 'file', 'citation']) {
      if (!isText(input.source[key])) fail(`source.${key} is required`);
    }
  }

  // Periods
  const periodIds = new Set<string>();
  if (!Array.isArray(input.periods) || input.periods.length === 0) {
    fail('periods must be a non-empty list');
  } else {
    input.periods.forEach((period: unknown, index) => {
      const where = `periods[${String(index)}]`;
      if (!isObject(period)) {
        fail(`${where} must be an object`);
        return;
      }
      if (!isText(period.id)) {
        fail(`${where}.id is required`);
      } else if (periodIds.has(period.id)) {
        fail(`${where}.id "${period.id}" is used twice`);
      } else {
        periodIds.add(period.id);
      }
      if (!isText(period.label)) fail(`${where}.label is required`);
      if (typeof period.endDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(period.endDate)) {
        fail(`${where}.endDate must look like 2021-01-30`);
      }
      if (period.note !== undefined && !isText(period.note)) {
        fail(`${where}.note must be text when present`);
      }
    });
  }

  const checkValues = (
    values: unknown,
    where: string,
    wholeNumbers: boolean,
    allowEmpty: boolean,
  ): void => {
    if (!isObject(values)) {
      fail(`${where} must be an object keyed by period id`);
      return;
    }
    const entries = Object.entries(values);
    if (entries.length === 0 && !allowEmpty) fail(`${where} must have at least one period`);
    for (const [period, amount] of entries) {
      if (!periodIds.has(period)) fail(`${where} names unknown period "${period}"`);
      if (typeof amount !== 'number' || !Number.isFinite(amount)) {
        fail(`${where}.${period} must be a number`);
      } else if (wholeNumbers && !Number.isInteger(amount)) {
        fail(`${where}.${period} must be a whole number of $ millions`);
      }
    }
  };

  // Line items and totals share one id space, because formulas point at both.
  const statementIds = new Set<string>();
  const lineItemIds = new Set<string>();
  const totalTerms = new Map<string, string[]>();

  const checkStatementLine = (line: Json, where: string): string | undefined => {
    let id: string | undefined;
    if (!isText(line.id) || !ID_PATTERN.test(line.id)) {
      fail(`${where}.id must be lower_snake_case`);
    } else if (statementIds.has(line.id)) {
      fail(`${where}.id "${line.id}" is used twice`);
    } else {
      id = line.id;
      statementIds.add(id);
    }
    if (!isText(line.label)) fail(`${where}.label is required`);
    if (typeof line.statement !== 'string' || !STATEMENTS.includes(line.statement)) {
      fail(`${where}.statement must be balance_sheet or income_statement`);
    }
    if (!isText(line.section)) fail(`${where}.section is required`);
    if (typeof line.normalBalance !== 'string' || !BALANCES.includes(line.normalBalance)) {
      fail(`${where}.normalBalance must be debit or credit`);
    }
    if (!isText(line.sourceRef))
      fail(`${where}.sourceRef is required: every number cites its source`);
    return id;
  };

  if (!Array.isArray(input.lineItems) || input.lineItems.length === 0) {
    fail('lineItems must be a non-empty list');
  } else {
    input.lineItems.forEach((item: unknown, index) => {
      const where = `lineItems[${String(index)}]`;
      if (!isObject(item)) {
        fail(`${where} must be an object`);
        return;
      }
      const id = checkStatementLine(item, where);
      if (id !== undefined) lineItemIds.add(id);
      checkValues(item.values, `${where}.values`, true, false);
    });
  }

  if (!Array.isArray(input.totals)) {
    fail('totals must be a list');
  } else {
    input.totals.forEach((total: unknown, index) => {
      const where = `totals[${String(index)}]`;
      if (!isObject(total)) {
        fail(`${where} must be an object`);
        return;
      }
      const id = checkStatementLine(total, where);
      const refs: string[] = [];
      if (!Array.isArray(total.terms) || total.terms.length === 0) {
        fail(`${where}.terms must be a non-empty list`);
      } else {
        total.terms.forEach((term: unknown, termIndex) => {
          const termWhere = `${where}.terms[${String(termIndex)}]`;
          if (!isObject(term)) {
            fail(`${termWhere} must be an object`);
            return;
          }
          if (!isText(term.ref)) {
            fail(`${termWhere}.ref is required`);
          } else {
            refs.push(term.ref);
          }
          if (term.sign !== 1 && term.sign !== -1) fail(`${termWhere}.sign must be 1 or -1`);
        });
      }
      if (id !== undefined) totalTerms.set(id, refs);
      if (total.printed !== undefined) {
        checkValues(total.printed, `${where}.printed`, true, false);
      }
    });
  }

  // Formulas point only at things that exist, and never at themselves.
  for (const [id, refs] of totalTerms) {
    for (const ref of refs) {
      if (!statementIds.has(ref)) fail(`total "${id}" refers to unknown id "${ref}"`);
    }
  }
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (id: string, path: readonly string[]): void => {
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'visiting') {
      fail(`totals form a cycle: ${[...path, id].join(' -> ')}`);
      return;
    }
    state.set(id, 'visiting');
    for (const ref of totalTerms.get(id) ?? []) {
      if (totalTerms.has(ref)) visit(ref, [...path, id]);
    }
    state.set(id, 'done');
  };
  for (const id of totalTerms.keys()) visit(id, []);

  // Facts
  const factIds = new Set<string>();
  if (!Array.isArray(input.facts)) {
    fail('facts must be a list');
  } else {
    input.facts.forEach((fact: unknown, index) => {
      const where = `facts[${String(index)}]`;
      if (!isObject(fact)) {
        fail(`${where} must be an object`);
        return;
      }
      if (!isText(fact.id) || !ID_PATTERN.test(fact.id)) {
        fail(`${where}.id must be lower_snake_case`);
      } else if (factIds.has(fact.id) || statementIds.has(fact.id)) {
        fail(`${where}.id "${fact.id}" is used twice`);
      } else {
        factIds.add(fact.id);
      }
      if (!isText(fact.label)) fail(`${where}.label is required`);
      if (typeof fact.unit !== 'string' || !FACT_UNITS.includes(fact.unit)) {
        fail(`${where}.unit must be one of ${FACT_UNITS.join(', ')}`);
      }
      if (!isText(fact.sourceRef))
        fail(`${where}.sourceRef is required: every number cites its source`);
      checkValues(fact.values, `${where}.values`, false, false);
    });
  }

  // Per-share checks
  if (!Array.isArray(input.perShareChecks)) {
    fail('perShareChecks must be a list');
  } else {
    input.perShareChecks.forEach((check: unknown, index) => {
      const where = `perShareChecks[${String(index)}]`;
      if (!isObject(check)) {
        fail(`${where} must be an object`);
        return;
      }
      if (!isText(check.result) || !factIds.has(check.result)) {
        fail(`${where}.result must be the id of a fact`);
      }
      if (!isText(check.numerator) || !statementIds.has(check.numerator)) {
        fail(`${where}.numerator must be the id of a line item or total`);
      }
      if (!isText(check.denominator) || !factIds.has(check.denominator)) {
        fail(`${where}.denominator must be the id of a fact`);
      }
      if (
        typeof check.decimals !== 'number' ||
        !Number.isInteger(check.decimals) ||
        check.decimals < 0 ||
        check.decimals > 6
      ) {
        fail(`${where}.decimals must be a whole number from 0 to 6`);
      }
    });
  }

  // Balance identity
  if (!isObject(input.balanceIdentity)) {
    fail('balanceIdentity is required');
  } else {
    for (const key of ['assets', 'liabilitiesAndEquity']) {
      const ref = input.balanceIdentity[key];
      if (!isText(ref) || !totalTerms.has(ref)) {
        fail(`balanceIdentity.${key} must be the id of a total`);
      }
    }
  }

  // Altered notice
  if (input.altered !== undefined) {
    if (!isObject(input.altered)) {
      fail('altered must be an object when present');
    } else {
      const periods: unknown = input.altered.periods;
      if (!Array.isArray(periods) || periods.length === 0) {
        fail('altered.periods must be a non-empty list');
      } else {
        for (const period of periods as unknown[]) {
          if (typeof period !== 'string' || !periodIds.has(period)) {
            fail(`altered.periods names unknown period "${String(period)}"`);
          }
        }
      }
      if (!isText(input.altered.notice)) fail('altered.notice is required');
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, scenario: input as unknown as Scenario };
}
