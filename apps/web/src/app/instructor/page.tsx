import type { Metadata } from 'next';
import { listSections } from '../../lib/sections';
import { requireInstructor } from '../../server/auth';
import { getConfig, getDb } from '../../server/context';
import { setSectionStatusAction } from './actions';
import { CreateSectionForm, UploadRosterForm } from './forms';

export const metadata: Metadata = { title: 'Instructor console' };

export default async function InstructorPage() {
  await requireInstructor();
  const sections = await listSections(getDb());
  const { allowedDomain } = getConfig();

  return (
    <>
      <h1>Instructor console</h1>

      <h2>Sections</h2>
      {sections.length === 0 ? (
        <p>There are no sections yet. Create one, then upload its roster.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Term</th>
              <th>Section</th>
              <th>Status</th>
              <th className="number">On roster</th>
              <th className="no-print">Change</th>
            </tr>
          </thead>
          <tbody>
            {sections.map((section) => (
              <tr key={section.id}>
                <td>{section.term}</td>
                <td>{section.name}</td>
                <td>{section.status === 'open' ? 'Open' : 'Closed'}</td>
                <td className="number">{section.rosterCount}</td>
                <td className="no-print">
                  <form action={setSectionStatusAction}>
                    <input type="hidden" name="sectionId" value={section.id} />
                    <input
                      type="hidden"
                      name="status"
                      value={section.status === 'open' ? 'closed' : 'open'}
                    />
                    <button type="submit">{section.status === 'open' ? 'Close' : 'Reopen'}</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p>
        Students on the roster of an open section can sign in. Closing a section signs its students
        out and keeps them out until you reopen it.
      </p>

      <h2>Create a section</h2>
      <CreateSectionForm />

      <h2>Upload a roster</h2>
      <p>
        Upload a CSV file whose first line names the columns. A row for someone already on the
        roster updates their code and role, at once, even if they are signed in. Uploading does not
        remove anyone.
      </p>
      <table>
        <thead>
          <tr>
            <th>Column</th>
            <th>What goes in it</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>email</code>
            </td>
            <td>The student&rsquo;s {allowedDomain} address.</td>
          </tr>
          <tr>
            <td>
              <code>student_code</code>
            </td>
            <td>
              A code you make up that does not identify the student, such as S-014. Letters, digits,
              hyphens and underscores.
            </td>
          </tr>
          <tr>
            <td>
              <code>section</code>
            </td>
            <td>The name of an open section, exactly as it appears in the table above.</td>
          </tr>
          <tr>
            <td>
              <code>role</code> (optional)
            </td>
            <td>
              <code>student</code> or <code>instructor</code>. Left empty, it means student.
            </td>
          </tr>
        </tbody>
      </table>
      <p>
        The file is not kept. Each email address is turned into a keyed hash and only the hash and
        the code are saved. Keep the list that matches codes to names on your own computer.
      </p>
      <UploadRosterForm />
    </>
  );
}
