import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateScenario } from '../src/index';
import type { Scenario } from '../src/index';

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const scenariosDir = join(repoRoot, 'scenarios');

/** Reads a scenario file as untyped data, without validating it. */
export function readScenarioFile(fileName: string): unknown {
  return JSON.parse(readFileSync(join(scenariosDir, fileName), 'utf8')) as unknown;
}

/** Reads and validates a scenario file. Throws with every validation error if it is malformed. */
export function loadScenario(fileName: string): Scenario {
  const result = validateScenario(readScenarioFile(fileName));
  if (!result.ok) {
    throw new Error(`${fileName} is not a valid scenario:\n${result.errors.join('\n')}`);
  }
  return result.scenario;
}

export function scenarioFileNames(): string[] {
  return readdirSync(scenariosDir)
    .filter((name) => name.endsWith('.json'))
    .sort();
}

/** A deep copy of the synthetic scenario as plain data, for tests that break one thing at a time. */
export function syntheticCopy(): Record<string, unknown> {
  return structuredClone(readScenarioFile('synthetic-practice-co.json')) as Record<string, unknown>;
}

type Row = Record<string, unknown>;

/** Finds an entry of a list field (lineItems, totals, facts) by id, for mutation in tests. */
export function entry(data: Record<string, unknown>, list: string, id: string): Row {
  const rows = data[list] as Row[];
  const found = rows.find((row) => row.id === id);
  if (found === undefined) throw new Error(`no ${list} entry with id "${id}"`);
  return found;
}

/** The first element of a list, failing the test if the list is empty. */
export function first<T>(rows: readonly T[]): T {
  const [row] = rows;
  if (row === undefined) throw new Error('expected a non-empty list');
  return row;
}

/** Validates mutated data and returns it as a scenario, failing the test if it is malformed. */
export function asScenario(data: unknown): Scenario {
  const result = validateScenario(data);
  if (!result.ok) throw new Error(result.errors.join('\n'));
  return result.scenario;
}
