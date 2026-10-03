import type { Db } from '../db/client';
import { auditLog } from '../db/schema';
import type { SessionUser } from './sessions';

export type AuditAction =
  'sign_in' | 'sign_out' | 'section_created' | 'section_status_changed' | 'roster_imported';

/** How a person appears in the audit log: by student code, or as the bootstrap instructor. */
export function actorCode(user: Pick<SessionUser, 'studentCode'>): string {
  return user.studentCode ?? 'instructor';
}

/** Records an action. The log holds codes and counts, never emails or names. */
export async function recordAudit(
  db: Db,
  actor: string,
  action: AuditAction,
  target?: string,
): Promise<void> {
  await db.insert(auditLog).values({ actorCode: actor, action, target: target ?? null });
}
