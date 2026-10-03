import { and, asc, count, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client';
import { roster, sections, sessions, users } from '../db/schema';

export interface SectionSummary {
  readonly id: string;
  readonly term: string;
  readonly name: string;
  readonly status: 'open' | 'closed';
  readonly rosterCount: number;
}

export type CreateSectionResult =
  { readonly ok: true; readonly id: string } | { readonly ok: false; readonly error: string };

/** Creates a section. Term and name together must be new. */
export async function createSection(
  db: Db,
  term: string,
  name: string,
): Promise<CreateSectionResult> {
  const cleanTerm = term.trim();
  const cleanName = name.trim();
  if (cleanTerm === '' || cleanName === '') {
    return { ok: false, error: 'A section needs a term and a name.' };
  }
  if (cleanTerm.length > 60 || cleanName.length > 60) {
    return { ok: false, error: 'Keep the term and the name under 60 characters each.' };
  }
  const [created] = await db
    .insert(sections)
    .values({ term: cleanTerm, name: cleanName })
    .onConflictDoNothing()
    .returning({ id: sections.id });
  if (created === undefined) {
    return { ok: false, error: 'A section with that term and name already exists.' };
  }
  return { ok: true, id: created.id };
}

/** Every section with the size of its roster, oldest first. */
export async function listSections(db: Db): Promise<SectionSummary[]> {
  const rows = await db
    .select({
      id: sections.id,
      term: sections.term,
      name: sections.name,
      status: sections.status,
      rosterCount: count(roster.id),
    })
    .from(sections)
    .leftJoin(roster, eq(roster.sectionId, sections.id))
    .groupBy(sections.id)
    .orderBy(asc(sections.createdAt));
  return rows;
}

/**
 * Opens or closes a section. Closing signs the section's students out, and
 * the roster gate keeps them out until the section is reopened.
 */
export async function setSectionStatus(
  db: Db,
  sectionId: string,
  status: 'open' | 'closed',
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const changed = await tx
      .update(sections)
      .set({ status })
      .where(eq(sections.id, sectionId))
      .returning({ id: sections.id });
    if (changed.length === 0) return false;
    if (status === 'closed') {
      // The session check would end these on their next request anyway.
      const students = tx
        .select({ id: users.id })
        .from(users)
        .innerJoin(roster, eq(users.rosterId, roster.id))
        .where(
          and(
            eq(users.admittedBy, 'roster'),
            eq(roster.sectionId, sectionId),
            eq(roster.role, 'student'),
          ),
        );
      await tx.delete(sessions).where(inArray(sessions.userId, students));
    }
    return true;
  });
}
