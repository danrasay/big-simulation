/**
 * The ratio engine.
 *
 * The 20 ratios of Exhibit 5 are data: each has a key formula and, where the
 * exhibit's wording allows more than one reading, accepted variants. The same
 * definitions compute the values, list the figures a formula uses (for the
 * "show your work" check) and judge a submitted answer.
 */
import type { Scenario } from './model';
import { priorPeriod, statementValues } from './statements';

export type RatioGroup = 'liquidity' | 'activity' | 'leverage' | 'profitability' | 'market_value';

export type RatioUnit = 'usd_millions' | 'times' | 'days' | 'percent' | 'usd_per_share';

/** A piece of a formula. */
export type Expr =
  /** A line item or total. `optional` lines count as zero when the company does not report them. */
  | { readonly kind: 'line'; readonly id: string; readonly optional: boolean }
  /** The average of a line item or total over the current and prior period. */
  | { readonly kind: 'average'; readonly id: string }
  /** A reported fact, such as a share count. */
  | { readonly kind: 'fact'; readonly id: string }
  | { readonly kind: 'number'; readonly value: number }
  /** Another ratio, by one of its definitions. */
  | { readonly kind: 'ratio'; readonly ratio: string; readonly definition: string }
  /** The first option that can be computed. */
  | { readonly kind: 'first'; readonly options: readonly Expr[] }
  | {
      readonly kind: 'op';
      readonly op: '+' | '-' | '/';
      readonly left: Expr;
      readonly right: Expr;
    };

export interface RatioFormula {
  /** "key" for the main definition, otherwise a variant id. */
  readonly id: string;
  /** The formula in words, as shown to students. */
  readonly label: string;
  readonly expr: Expr;
}

export interface RatioDefinition {
  readonly id: string;
  readonly name: string;
  readonly group: RatioGroup;
  readonly unit: RatioUnit;
  /** Decimal places for display. */
  readonly decimals: number;
  readonly key: RatioFormula;
  readonly variants: readonly RatioFormula[];
}

const line = (id: string): Expr => ({ kind: 'line', id, optional: false });
const optionalLine = (id: string): Expr => ({ kind: 'line', id, optional: true });
const average = (id: string): Expr => ({ kind: 'average', id });
const fact = (id: string): Expr => ({ kind: 'fact', id });
const number = (value: number): Expr => ({ kind: 'number', value });
const ratio = (id: string, definition = 'key'): Expr => ({ kind: 'ratio', ratio: id, definition });
const add = (left: Expr, right: Expr): Expr => ({ kind: 'op', op: '+', left, right });
const subtract = (left: Expr, right: Expr): Expr => ({ kind: 'op', op: '-', left, right });
const divide = (left: Expr, right: Expr): Expr => ({ kind: 'op', op: '/', left, right });

/** Dividends per share as reported, or dividends paid over weighted shares when only the total is reported. */
const dividendsPerShare: Expr = {
  kind: 'first',
  options: [
    fact('dividends_per_share'),
    divide(fact('dividends_paid'), fact('weighted_shares_basic')),
  ],
};

/** Debt that bears interest: short-term debt, the current portion of long-term debt, and long-term debt. */
const interestBearingDebt: Expr = add(
  add(optionalLine('short_term_debt'), optionalLine('current_portion_of_long_term_debt')),
  line('long_term_debt'),
);

const PERIOD_END = 'period_end_shares';

/** The 20 ratios of Exhibit 5, in the exhibit's order. */
export const RATIOS: readonly RatioDefinition[] = [
  {
    id: 'net_working_capital',
    name: 'Net working capital',
    group: 'liquidity',
    unit: 'usd_millions',
    decimals: 0,
    key: {
      id: 'key',
      label: 'Current assets - current liabilities',
      expr: subtract(line('total_current_assets'), line('total_current_liabilities')),
    },
    variants: [],
  },
  {
    id: 'current_ratio',
    name: 'Current ratio',
    group: 'liquidity',
    unit: 'times',
    decimals: 2,
    key: {
      id: 'key',
      label: 'Current assets / current liabilities',
      expr: divide(line('total_current_assets'), line('total_current_liabilities')),
    },
    variants: [],
  },
  {
    id: 'quick_ratio',
    name: 'Quick ratio',
    group: 'liquidity',
    unit: 'times',
    decimals: 2,
    key: {
      id: 'key',
      label: '(Cash + marketable securities + receivables) / current liabilities',
      expr: divide(
        add(
          add(line('cash_and_equivalents'), optionalLine('marketable_securities')),
          line('receivables_net'),
        ),
        line('total_current_liabilities'),
      ),
    },
    variants: [],
  },
  {
    id: 'receivables_turnover',
    name: 'Accounts receivable turnover',
    group: 'activity',
    unit: 'times',
    decimals: 2,
    key: {
      id: 'key',
      label: 'Revenue / average accounts receivable',
      expr: divide(line('revenue'), average('receivables_net')),
    },
    variants: [],
  },
  {
    id: 'average_collection_period',
    name: 'Average collection period',
    group: 'activity',
    unit: 'days',
    decimals: 1,
    key: {
      id: 'key',
      label: '365 / accounts receivable turnover',
      expr: divide(number(365), ratio('receivables_turnover')),
    },
    variants: [],
  },
  {
    id: 'inventory_turnover',
    name: 'Inventory turnover',
    group: 'activity',
    unit: 'times',
    decimals: 2,
    key: {
      id: 'key',
      label: 'Cost of goods sold / average inventory',
      expr: divide(line('cost_of_sales'), average('inventories')),
    },
    variants: [],
  },
  {
    id: 'average_age_of_inventory',
    name: 'Average age of inventory',
    group: 'activity',
    unit: 'days',
    decimals: 1,
    key: {
      id: 'key',
      label: '365 / inventory turnover',
      expr: divide(number(365), ratio('inventory_turnover')),
    },
    variants: [],
  },
  {
    id: 'total_asset_turnover',
    name: 'Total asset turnover',
    group: 'activity',
    unit: 'times',
    decimals: 2,
    key: {
      id: 'key',
      label: 'Revenue / average total assets',
      expr: divide(line('revenue'), average('total_assets')),
    },
    variants: [],
  },
  {
    id: 'debt_ratio',
    name: 'Debt ratio',
    group: 'leverage',
    unit: 'times',
    decimals: 3,
    key: {
      id: 'key',
      label: 'Total liabilities / total assets',
      expr: divide(line('total_liabilities'), line('total_assets')),
    },
    variants: [
      {
        id: 'interest_bearing_debt',
        label: 'Interest-bearing debt / total assets',
        expr: divide(interestBearingDebt, line('total_assets')),
      },
    ],
  },
  {
    id: 'debt_to_equity',
    name: 'Debt/equity ratio',
    group: 'leverage',
    unit: 'times',
    decimals: 2,
    key: {
      id: 'key',
      label: "Total liabilities / stockholders' equity",
      expr: divide(line('total_liabilities'), line('total_equity')),
    },
    variants: [],
  },
  {
    id: 'times_interest_earned',
    name: 'Times interest earned',
    group: 'leverage',
    unit: 'times',
    decimals: 1,
    key: {
      id: 'key',
      label: '(Earnings before tax + interest expense) / interest expense',
      expr: divide(
        add(line('income_before_tax'), line('interest_expense')),
        line('interest_expense'),
      ),
    },
    variants: [
      {
        id: 'operating_income',
        label: 'Operating income / interest expense',
        expr: divide(line('operating_income'), line('interest_expense')),
      },
    ],
  },
  {
    id: 'gross_profit_margin',
    name: 'Gross profit margin',
    group: 'profitability',
    unit: 'percent',
    decimals: 1,
    key: {
      id: 'key',
      label: 'Gross profit / revenue',
      expr: divide(line('gross_profit'), line('revenue')),
    },
    variants: [],
  },
  {
    id: 'profit_margin',
    name: 'Profit margin',
    group: 'profitability',
    unit: 'percent',
    decimals: 1,
    key: {
      id: 'key',
      label: 'Net income / revenue',
      expr: divide(line('net_income'), line('revenue')),
    },
    variants: [],
  },
  {
    id: 'return_on_total_assets',
    name: 'Return on total assets',
    group: 'profitability',
    unit: 'percent',
    decimals: 1,
    key: {
      id: 'key',
      label: 'Net income / average total assets',
      expr: divide(line('net_income'), average('total_assets')),
    },
    variants: [],
  },
  {
    id: 'return_on_common_equity',
    name: 'Return on common equity',
    group: 'profitability',
    unit: 'percent',
    decimals: 1,
    key: {
      id: 'key',
      label: 'Net income / common equity',
      expr: divide(line('net_income'), line('total_equity')),
    },
    variants: [],
  },
  {
    id: 'earnings_per_share',
    name: 'Earnings per share',
    group: 'market_value',
    unit: 'usd_per_share',
    decimals: 2,
    key: {
      id: 'key',
      label: 'Net income / weighted-average common shares',
      expr: divide(line('net_income'), fact('weighted_shares_basic')),
    },
    variants: [
      {
        id: PERIOD_END,
        label: 'Net income / common shares outstanding at period end',
        expr: divide(line('net_income'), fact('shares_outstanding')),
      },
    ],
  },
  {
    id: 'price_earnings',
    name: 'Price/earnings ratio',
    group: 'market_value',
    unit: 'times',
    decimals: 1,
    key: {
      id: 'key',
      label: 'Market price per share / earnings per share',
      expr: divide(fact('market_price_per_share'), ratio('earnings_per_share')),
    },
    variants: [
      {
        id: PERIOD_END,
        label: 'Market price per share / earnings per share on period-end shares',
        expr: divide(fact('market_price_per_share'), ratio('earnings_per_share', PERIOD_END)),
      },
    ],
  },
  {
    id: 'book_value_per_share',
    name: 'Book value per share',
    group: 'market_value',
    unit: 'usd_per_share',
    decimals: 2,
    key: {
      id: 'key',
      label: "Stockholders' equity / common shares outstanding",
      expr: divide(line('total_equity'), fact('shares_outstanding')),
    },
    variants: [],
  },
  {
    id: 'dividend_yield',
    name: 'Dividend yield',
    group: 'market_value',
    unit: 'percent',
    decimals: 1,
    key: {
      id: 'key',
      label: 'Dividends per share / market price per share',
      expr: divide(dividendsPerShare, fact('market_price_per_share')),
    },
    variants: [],
  },
  {
    id: 'dividend_payout',
    name: 'Dividend payout',
    group: 'market_value',
    unit: 'percent',
    decimals: 1,
    key: {
      id: 'key',
      label: 'Dividends per share / earnings per share',
      expr: divide(dividendsPerShare, ratio('earnings_per_share')),
    },
    variants: [
      {
        id: PERIOD_END,
        label: 'Dividends per share / earnings per share on period-end shares',
        expr: divide(dividendsPerShare, ratio('earnings_per_share', PERIOD_END)),
      },
    ],
  },
];

/** A figure a formula uses: which line or fact, in which period. */
export interface Citation {
  readonly id: string;
  readonly period: string;
}

export type Unavailable =
  /** The company does not report a figure the formula needs. */
  | { readonly reason: 'missing_input'; readonly ids: readonly string[] }
  /** The formula needs an average, and the scenario has no earlier period. */
  | { readonly reason: 'no_prior_period' }
  | { readonly reason: 'division_by_zero' };

export type DefinitionResult =
  | {
      readonly id: string;
      readonly label: string;
      readonly available: true;
      /** Unrounded. Percent ratios are in percent: 22.4, not 0.224. */
      readonly value: number;
      /** The figures this formula used, for the "show your work" check. */
      readonly inputs: readonly Citation[];
    }
  | {
      readonly id: string;
      readonly label: string;
      readonly available: false;
      readonly unavailable: Unavailable;
    };

export interface RatioResult {
  readonly id: string;
  readonly name: string;
  readonly group: RatioGroup;
  readonly unit: RatioUnit;
  readonly decimals: number;
  /** The key definition first, then the accepted variants. */
  readonly definitions: readonly DefinitionResult[];
}

type Outcome =
  | { readonly ok: true; readonly value: number; readonly inputs: readonly Citation[] }
  | { readonly ok: false; readonly unavailable: Unavailable };

function findFormula(ratioId: string, definitionId: string): RatioFormula {
  const definition = RATIOS.find((candidate) => candidate.id === ratioId);
  const formula =
    definitionId === 'key'
      ? definition?.key
      : definition?.variants.find((variant) => variant.id === definitionId);
  if (formula === undefined) {
    throw new Error(`no ratio formula "${ratioId}" / "${definitionId}"`);
  }
  return formula;
}

function uniqueCitations(citations: readonly Citation[]): Citation[] {
  const seen = new Set<string>();
  const result: Citation[] = [];
  for (const citation of citations) {
    const key = `${citation.id}@${citation.period}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(citation);
    }
  }
  return result;
}

/**
 * Computes all 20 ratios for one period.
 *
 * A ratio that needs a figure the scenario does not have, such as a share
 * price or an earlier balance sheet, comes back unavailable with the reason.
 * It is never estimated.
 */
export function computeRatios(scenario: Scenario, period: string): RatioResult[] {
  const prior = priorPeriod(scenario, period);
  const current = statementValues(scenario, period);
  const earlier = prior === undefined ? undefined : statementValues(scenario, prior);
  const facts = new Map(scenario.facts.map((entry) => [entry.id, entry]));

  const evaluate = (expr: Expr): Outcome => {
    switch (expr.kind) {
      case 'number':
        return { ok: true, value: expr.value, inputs: [] };
      case 'line': {
        const value = current.get(expr.id);
        if (value === undefined) {
          if (expr.optional) return { ok: true, value: 0, inputs: [] };
          return { ok: false, unavailable: { reason: 'missing_input', ids: [expr.id] } };
        }
        return { ok: true, value, inputs: [{ id: expr.id, period }] };
      }
      case 'average': {
        const now = current.get(expr.id);
        if (now === undefined) {
          return { ok: false, unavailable: { reason: 'missing_input', ids: [expr.id] } };
        }
        const before = earlier?.get(expr.id);
        if (prior === undefined || before === undefined) {
          return { ok: false, unavailable: { reason: 'no_prior_period' } };
        }
        return {
          ok: true,
          value: (now + before) / 2,
          inputs: [
            { id: expr.id, period },
            { id: expr.id, period: prior },
          ],
        };
      }
      case 'fact': {
        const value = facts.get(expr.id)?.values[period];
        if (value === undefined) {
          return { ok: false, unavailable: { reason: 'missing_input', ids: [expr.id] } };
        }
        return { ok: true, value, inputs: [{ id: expr.id, period }] };
      }
      case 'ratio':
        return evaluate(findFormula(expr.ratio, expr.definition).expr);
      case 'first': {
        const missing: string[] = [];
        let other: Unavailable | undefined;
        for (const option of expr.options) {
          const outcome = evaluate(option);
          if (outcome.ok) return outcome;
          if (outcome.unavailable.reason === 'missing_input') {
            missing.push(...outcome.unavailable.ids);
          } else {
            other = outcome.unavailable;
          }
        }
        return { ok: false, unavailable: other ?? { reason: 'missing_input', ids: missing } };
      }
      case 'op': {
        const left = evaluate(expr.left);
        if (!left.ok) return left;
        const right = evaluate(expr.right);
        if (!right.ok) return right;
        const inputs = [...left.inputs, ...right.inputs];
        if (expr.op === '+') return { ok: true, value: left.value + right.value, inputs };
        if (expr.op === '-') return { ok: true, value: left.value - right.value, inputs };
        if (right.value === 0) return { ok: false, unavailable: { reason: 'division_by_zero' } };
        return { ok: true, value: left.value / right.value, inputs };
      }
    }
  };

  const run = (definition: RatioDefinition, formula: RatioFormula): DefinitionResult => {
    const outcome = evaluate(formula.expr);
    if (!outcome.ok) {
      return {
        id: formula.id,
        label: formula.label,
        available: false,
        unavailable: outcome.unavailable,
      };
    }
    return {
      id: formula.id,
      label: formula.label,
      available: true,
      value: definition.unit === 'percent' ? outcome.value * 100 : outcome.value,
      inputs: uniqueCitations(outcome.inputs),
    };
  };

  return RATIOS.map((definition) => ({
    id: definition.id,
    name: definition.name,
    group: definition.group,
    unit: definition.unit,
    decimals: definition.decimals,
    definitions: [definition.key, ...definition.variants].map((formula) =>
      run(definition, formula),
    ),
  }));
}

export interface Tolerance {
  /** Share of the expected value, for example 0.01 for 1%. */
  readonly relative: number;
  /** In the ratio's own unit. */
  readonly absolute: number;
}

/** A submitted value passes within 1% of the expected value, or within 0.01, whichever is wider. */
export const DEFAULT_TOLERANCE: Tolerance = { relative: 0.01, absolute: 0.01 };

function within(submitted: number, expected: number, tolerance: Tolerance): boolean {
  const allowed = Math.max(tolerance.absolute, tolerance.relative * Math.abs(expected));
  // The small allowance keeps a value that sits exactly on the edge from
  // failing because of how binary floating point stores it.
  return Math.abs(submitted - expected) <= allowed + 1e-12;
}

export type AnswerCheck =
  /** The answer matches this definition: "key", or the id of an accepted variant. */
  | { readonly status: 'match'; readonly definition: string }
  | { readonly status: 'no_match' }
  /** The ratio cannot be computed for this scenario, so there is nothing to check against. */
  | { readonly status: 'unavailable' };

/**
 * Judges a submitted value against a computed ratio.
 *
 * It passes if it is within tolerance of the key or of an accepted variant,
 * and the result names the closest one. For a percent ratio, 22.4 and 0.224
 * are both read as 22.4%.
 */
export function checkRatioAnswer(
  result: RatioResult,
  submitted: number,
  tolerance: Tolerance = DEFAULT_TOLERANCE,
): AnswerCheck {
  const available = result.definitions.filter((definition) => definition.available);
  if (available.length === 0) return { status: 'unavailable' };
  if (!Number.isFinite(submitted)) return { status: 'no_match' };

  const readings = result.unit === 'percent' ? [submitted, submitted * 100] : [submitted];
  let best: { definition: string; distance: number } | undefined;
  for (const definition of available) {
    for (const reading of readings) {
      if (!within(reading, definition.value, tolerance)) continue;
      const distance = Math.abs(reading - definition.value);
      if (best === undefined || distance < best.distance) {
        best = { definition: definition.id, distance };
      }
    }
  }
  return best === undefined
    ? { status: 'no_match' }
    : { status: 'match', definition: best.definition };
}

export type CitationCheck =
  /** The cited figures are exactly the inputs of this definition. */
  | { readonly status: 'match'; readonly definition: string }
  /** Compared with the key definition: figures the formula needs that were not cited, and cited figures it does not use. */
  | {
      readonly status: 'no_match';
      readonly missing: readonly Citation[];
      readonly extra: readonly Citation[];
    }
  | { readonly status: 'unavailable' };

/**
 * The "show your work" check: are the figures a student clicked exactly the
 * ones a definition of the ratio uses? Order and repeats do not matter.
 */
export function checkCitation(result: RatioResult, cited: readonly Citation[]): CitationCheck {
  const available = result.definitions.filter((definition) => definition.available);
  const reference = available[0];
  if (reference === undefined) return { status: 'unavailable' };

  const keyOf = (citation: Citation): string => `${citation.id}@${citation.period}`;
  const citedKeys = new Set(cited.map(keyOf));
  for (const definition of available) {
    const needed = new Set(definition.inputs.map(keyOf));
    if (needed.size === citedKeys.size && [...needed].every((key) => citedKeys.has(key))) {
      return { status: 'match', definition: definition.id };
    }
  }

  const needed = new Set(reference.inputs.map(keyOf));
  return {
    status: 'no_match',
    missing: reference.inputs.filter((citation) => !citedKeys.has(keyOf(citation))),
    extra: uniqueCitations(cited).filter((citation) => !needed.has(keyOf(citation))),
  };
}
