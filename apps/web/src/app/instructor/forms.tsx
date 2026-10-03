'use client';

import { useActionState } from 'react';
import { createSectionAction, uploadRosterAction } from './actions';
import { EMPTY_FORM_STATE } from './form-state';
import type { FormState } from './form-state';

function Result({ state }: { readonly state: FormState }) {
  if (state.ok === undefined) return null;
  return (
    <div className={state.ok ? 'notice' : 'notice notice-problem'} role="status">
      <p>
        <strong>{state.ok ? 'Done.' : 'Not done.'}</strong> {state.message}
      </p>
      {state.problems.length === 0 ? null : (
        <table>
          <thead>
            <tr>
              <th className="number">Line</th>
              <th>Problem</th>
            </tr>
          </thead>
          <tbody>
            {state.problems.map((problem, index) => (
              <tr key={`${String(problem.line)}-${String(index)}`}>
                <td className="number">{problem.line}</td>
                <td>{problem.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function CreateSectionForm() {
  const [state, action, pending] = useActionState(createSectionAction, EMPTY_FORM_STATE);
  return (
    <form action={action}>
      <div className="field-row">
        <div>
          <label htmlFor="section-term">Term</label>
          <input id="section-term" name="term" required maxLength={60} placeholder="Fall 2026" />
        </div>
        <div>
          <label htmlFor="section-name">Section name</label>
          <input id="section-name" name="name" required maxLength={60} placeholder="ELI 275-01" />
        </div>
        <button type="submit" disabled={pending}>
          Create section
        </button>
      </div>
      <Result state={state} />
    </form>
  );
}

export function UploadRosterForm() {
  const [state, action, pending] = useActionState(uploadRosterAction, EMPTY_FORM_STATE);
  return (
    <form action={action}>
      <div className="field-row">
        <div>
          <label htmlFor="roster-file">Roster file (CSV)</label>
          <input id="roster-file" name="roster" type="file" accept=".csv,text/csv" required />
        </div>
        <button type="submit" disabled={pending}>
          Upload roster
        </button>
      </div>
      <Result state={state} />
    </form>
  );
}
