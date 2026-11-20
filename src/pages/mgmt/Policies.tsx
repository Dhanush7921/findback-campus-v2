import { Eye, FileLock2, Fingerprint, Handshake, KeyRound, ScrollText, ShieldCheck, UserCheck } from 'lucide-react';
import { Card, PageHeader } from '../../components/ui';

const ITEMS = [
  [Fingerprint, 'Verified identity', 'Students and guests sign in with a one-time SMS code (Firebase Authentication). The API verifies every identity token server-side. Students must also match the college-approved student registry; entering a student ID is never enough.'],
  [UserCheck, 'Role-based access', 'Main Admin and Management use Google sign-in. Roles come from the Staff_Roles register and are re-checked on every API request. Management is read-only: every write endpoint rejects it on the server, not just in the interface.'],
  [Handshake, 'Receiver-confirmed handover', 'An item is marked Returned only after (1) ownership is approved, (2) the receiver’s ID is checked, (3) the receiver enters a one-time desk code on their own verified phone and acknowledges receipt, and (4) a Main Admin confirms physical release. Codes expire in 10 minutes, are single-use and lock after 5 wrong attempts.'],
  [ScrollText, 'Audit trail', 'Every staff action, export and sign-in is appended to the Activity_Log. The application can only append to it; edits are refused at the storage layer.'],
  [Eye, 'Least privilege & redaction', 'Management sees who reported each case but not phone numbers, ownership evidence, private item details or storage locations. ID-card and hall-ticket numbers are masked in every reporter-facing and management listing.'],
  [FileLock2, 'Private storage', 'Records live in a private Google Sheet editable only by the API’s service identity. Photos, signatures and backups are in a private Cloud Storage bucket and are served only through authorised API calls.'],
  [KeyRound, 'Secrets & infrastructure', 'Session and hashing keys are in Google Secret Manager. The API runs on Cloud Run with its own service account; no downloadable service-account keys exist. Traffic is HTTPS only with strict CORS.'],
  [ShieldCheck, 'Retention & recovery', 'Personal data on closed cases is redacted after the configured retention period. Admins can create JSON backups at any time, and every schema change is preceded by an automatic backup.'],
] as const;

export default function Policies() {
  return (
    <>
      <PageHeader title="Policies & security overview" lead="How FindBack protects students, guests and the college." />
      <div className="grid gap-4 md:grid-cols-2">
        {ITEMS.map(([Icon, title, text]) => (
          <Card key={title} className="p-6">
            <span className="mb-3 grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-emerald-50 to-sky-50 text-teal-700 ring-1 ring-teal-100"><Icon className="h-5 w-5" /></span>
            <h2 className="font-bold">{title}</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-600">{text}</p>
          </Card>
        ))}
      </div>
    </>
  );
}
