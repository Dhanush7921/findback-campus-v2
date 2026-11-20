import { Card, PageHeader } from '../../components/ui';
import { useI18n } from '../../lib/i18n';

export default function Privacy() {
  const { t } = useI18n();
  return (
    <div className="safe-x mx-auto max-w-3xl py-10 sm:py-14">
      <PageHeader eyebrow="FindBack" title={t('privacy.title')} lead="Effective from launch. This notice explains what FindBack collects, why, who can see it and how long it is kept." />
      <Card className="prose-fb p-6 sm:p-9">
        <h2>What we collect</h2>
        <ul>
          <li>Your verified mobile number. For students, your name, student ID and department come from the college registry; guests give their name and visit details.</li>
          <li>Details of the lost item, where and when it was lost, an optional photo and private ownership evidence.</li>
          <li>Technical records needed for security: request timestamps, a truncated one-way hash of your network address, sign-in events and failed-code counters. We do not use tracking cookies or analytics scripts.</li>
        </ul>
        <h2>Why we collect it</h2>
        <p>Only to match lost items with found items, verify ownership before releasing property, contact you about your complaint, and protect the service from abuse.</p>
        <h2>Who can see it</h2>
        <ul>
          <li>You, after verifying your phone with a one-time SMS code.</li>
          <li>Authorised lost & found staff (Main Admin), who sign in with institution-approved Google accounts. Every staff action is recorded in an append-only audit log.</li>
          <li>College management, read-only: statistics, case status and who reported. Management never sees phone numbers, ownership evidence or private item details.</li>
          <li>No other student can see your complaint. There is no public list or search of complaints.</li>
        </ul>
        <h2>How it is protected</h2>
        <ul>
          <li>All traffic uses HTTPS. Records are stored in a private institutional Google Sheet; photos, signatures and backups in a private Google Cloud Storage bucket. Neither is published or shared publicly.</li>
          <li>Sign-in uses Firebase Authentication only to prove you control your phone number; your records are not stored there. Sessions expire after 30 minutes.</li>
          <li>Handover codes are single-use, expire in 10 minutes and are stored only as keyed one-way hashes.</li>
          <li>Found-item photos and private details are never shown to reporters, and ID-card numbers are masked, to prevent false claims.</li>
        </ul>
        <h2>Retention</h2>
        <p>When a complaint is returned or closed, personal details (name, ID, contact, ownership evidence, photo) are automatically redacted after the retention period set by the office (default 180 days). Anonymous counts are kept for reporting. Unclaimed found items are reviewed after the configured period and may be donated or disposed of per institutional policy.</p>
        <h2>Your choices</h2>
        <p>You can add information to or cancel your complaint from your portal at any time. To request correction or early deletion, contact the lost & found office.</p>
        <h2>Usage guidelines</h2>
        <ul>
          <li>Submit only genuine complaints for items you own. False claims may be referred to the institution’s disciplinary process.</li>
          <li>Never share an SMS sign-in code with anyone. Staff will never ask for it — the only code you enter at the counter is the one staff show you.</li>
          <li>Do not include passwords, bank details or other sensitive secrets in any field.</li>
          <li>Automated or bulk submissions are blocked.</li>
        </ul>
      </Card>
    </div>
  );
}
