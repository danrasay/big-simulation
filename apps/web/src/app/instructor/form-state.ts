import type { RosterProblem } from '../../lib/roster';

/** What a form on the instructor console shows after it is submitted. */
export interface FormState {
  /** Undefined before the first submission. */
  readonly ok: boolean | undefined;
  readonly message: string;
  readonly problems: readonly RosterProblem[];
}

export const EMPTY_FORM_STATE: FormState = { ok: undefined, message: '', problems: [] };
