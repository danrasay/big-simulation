'use server';

import { revalidatePath } from 'next/cache';
import { actorCode, recordAudit } from '../../lib/audit';
import { importRoster, parseRoster } from '../../lib/roster';
import { createSection, setSectionStatus } from '../../lib/sections';
import { requireInstructorForAction } from '../../server/auth';
import { getConfig, getDb } from '../../server/context';
import type { FormState } from './form-state';

// Every action starts with requireInstructorForAction(). A server action is a
// public endpoint: anyone can call it, whatever page they were shown.

const MAX_ROSTER_BYTES = 512 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const text = (formData: FormData, name: string): string => {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
};

const failure = (message: string): FormState => ({ ok: false, message, problems: [] });

export async function createSectionAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireInstructorForAction();
  const db = getDb();
  const term = text(formData, 'term');
  const name = text(formData, 'name');
  const result = await createSection(db, term, name);
  if (!result.ok) return failure(result.error);
  await recordAudit(db, actorCode(user), 'section_created', `${term.trim()} / ${name.trim()}`);
  revalidatePath('/instructor');
  return { ok: true, message: `Section ${name.trim()} was created.`, problems: [] };
}

export async function setSectionStatusAction(formData: FormData): Promise<void> {
  const user = await requireInstructorForAction();
  const sectionId = text(formData, 'sectionId');
  const status = text(formData, 'status');
  if (!UUID.test(sectionId) || (status !== 'open' && status !== 'closed')) return;
  const db = getDb();
  if (await setSectionStatus(db, sectionId, status)) {
    await recordAudit(db, actorCode(user), 'section_status_changed', `${sectionId} ${status}`);
  }
  revalidatePath('/instructor');
}

export async function uploadRosterAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireInstructorForAction();
  const file = formData.get('roster');
  if (!(file instanceof File) || file.size === 0) return failure('Choose a roster file first.');
  if (file.size > MAX_ROSTER_BYTES) return failure('That file is too large to be a roster.');

  // The file is read into memory, hashed row by row, and then dropped.
  const config = getConfig();
  const parsed = parseRoster(await file.text(), config.allowedDomain);
  if (parsed.problems.length > 0) {
    return {
      ok: false,
      message: 'Nothing was loaded. Fix these lines and upload the file again.',
      problems: parsed.problems,
    };
  }
  const db = getDb();
  const result = await importRoster(db, parsed.rows, config.identityPepper);
  if (!result.ok) {
    return {
      ok: false,
      message: 'Nothing was loaded. Fix these lines and upload the file again.',
      problems: result.problems,
    };
  }
  const counts = `added ${String(result.added)}, updated ${String(result.updated)}, unchanged ${String(result.unchanged)}`;
  await recordAudit(db, actorCode(user), 'roster_imported', counts);
  revalidatePath('/instructor');
  return { ok: true, message: `Roster loaded: ${counts}.`, problems: [] };
}
