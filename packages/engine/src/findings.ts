/**
 * Investigator flags and the coverage check.
 *
 * A flag is what a student files: some line items, a category and the
 * evidence. A findings key is the instructor's list of expected findings,
 * each tied to line items. Coverage says which expected findings the flags
 * reach. This module holds the mechanics only: findings keys are answer
 * keys and are never part of this repository.
 */
import type { MaterialityRow } from './differences';
import type { Scenario } from './model';

/** The six questions the project description asks the Investigator, a to f. */
export const FINDING_CATEGORIES = [
  {
    id: 'not_gaap',
    question: 'a',
    label: 'A change that does not conform with GAAP or other reporting guidelines',
  },
  { id: 'misleading', question: 'b', label: 'A misleading change or explanation' },
  { id: 'missing_footnote', question: 'c', label: 'A required footnote that is missing' },
  { id: 'unexplained', question: 'd', label: 'An unexplained change that might indicate fraud' },
  {
    id: 'information_needed',
    question: 'e',
    label: 'Other information that should be furnished',
  },
  { id: 'other', question: 'f', label: 'Another opinion or impression of the statements' },
] as const;

export type FindingCategory = (typeof FINDING_CATEGORIES)[number]['id'];

export interface Flag {
  /** Ids of the line items or totals the flag is about. At least one. */
  readonly lineItems: readonly string[];
  readonly category: FindingCategory;
  readonly evidence: string;
}

export type FlagValidation =
  | { readonly ok: true; readonly flag: Flag }
  | { readonly ok: false; readonly errors: readonly string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Checks untrusted data is a flag about rows that exist in the scenario. */
export function validateFlag(scenario: Scenario, input: unknown): FlagValidation {
  if (!isRecord(input)) return { ok: false, errors: ['flag must be an object'] };
  const errors: string[] = [];

  const known = new Set([...scenario.lineItems, ...scenario.totals].map((row) => row.id));
  const lineItems: string[] = [];
  if (!Array.isArray(input.lineItems) || input.lineItems.length === 0) {
    errors.push('lineItems must name at least one line item');
  } else {
    for (const id of input.lineItems as unknown[]) {
      if (typeof id !== 'string' || !known.has(id)) {
        errors.push(`lineItems names unknown line "${String(id)}"`);
      } else if (!lineItems.includes(id)) {
        lineItems.push(id);
      }
    }
  }

  const category = FINDING_CATEGORIES.find((candidate) => candidate.id === input.category);
  if (category === undefined) {
    errors.push(`category must be one of ${FINDING_CATEGORIES.map((c) => c.id).join(', ')}`);
  }

  const evidence = typeof input.evidence === 'string' ? input.evidence.trim() : '';
  if (evidence.length === 0) errors.push('evidence is required');

  if (category === undefined || errors.length > 0) return { ok: false, errors };
  return { ok: true, flag: { lineItems, category: category.id, evidence } };
}

/** True when the flag cites at least one row whose change is material. */
export function flagIsMaterial(flag: Flag, rows: readonly MaterialityRow[]): boolean {
  return flag.lineItems.some((id) => rows.some((row) => row.id === id && row.material));
}

export interface KeyFinding {
  readonly id: string;
  /** A flag that cites any of these rows reaches this finding. */
  readonly lineItems: readonly string[];
}

export interface FindingsKey {
  /** Id of the scenario the key belongs to. */
  readonly scenario: string;
  readonly findings: readonly KeyFinding[];
}

/** Lists what is wrong with a findings key for a scenario. An empty list means it is usable. */
export function findingsKeyProblems(scenario: Scenario, key: FindingsKey): string[] {
  const problems: string[] = [];
  if (key.scenario !== scenario.id) {
    problems.push(`key is for scenario "${key.scenario}", not "${scenario.id}"`);
  }
  const known = new Set([...scenario.lineItems, ...scenario.totals].map((row) => row.id));
  const seen = new Set<string>();
  for (const finding of key.findings) {
    if (seen.has(finding.id)) problems.push(`finding "${finding.id}" appears twice`);
    seen.add(finding.id);
    if (finding.lineItems.length === 0) problems.push(`finding "${finding.id}" names no rows`);
    for (const id of finding.lineItems) {
      if (!known.has(id)) problems.push(`finding "${finding.id}" names unknown line "${id}"`);
    }
  }
  return problems;
}

export interface FindingCoverage {
  readonly id: string;
  readonly covered: boolean;
  /** Positions, in the list of flags, of the flags that reach this finding. */
  readonly flags: readonly number[];
}

export interface CoverageReport {
  readonly findings: readonly FindingCoverage[];
  readonly coveredCount: number;
  readonly total: number;
  /**
   * Positions of flags that reach no finding in the key. These are not wrong:
   * they are the candidates for a valid finding outside the key, which is for
   * the instructor to judge.
   */
  readonly flagsOutsideKey: readonly number[];
}

/**
 * Which findings in the key a set of flags reaches. A finding is covered when
 * any flag cites any of its rows.
 *
 * This runs on the server, and its result is shown to students only after the
 * instructor releases it.
 */
export function coverage(key: FindingsKey, flags: readonly Flag[]): CoverageReport {
  const reaches = (finding: KeyFinding, flag: Flag): boolean =>
    flag.lineItems.some((id) => finding.lineItems.includes(id));

  const findings = key.findings.map((finding): FindingCoverage => {
    const reaching = flags.flatMap((flag, index) => (reaches(finding, flag) ? [index] : []));
    return { id: finding.id, covered: reaching.length > 0, flags: reaching };
  });

  return {
    findings,
    coveredCount: findings.filter((finding) => finding.covered).length,
    total: findings.length,
    flagsOutsideKey: flags.flatMap((flag, index) =>
      key.findings.some((finding) => reaches(finding, flag)) ? [] : [index],
    ),
  };
}
