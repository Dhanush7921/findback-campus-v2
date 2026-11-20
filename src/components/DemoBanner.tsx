import { FlaskConical, LogOut, RotateCcw, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { exitDemo, isDemo, resetDemo } from '../lib/demo';
import { getSession } from '../lib/session';
import { Button, Modal, Notice } from './ui';

/** Permanent demo indicator. Reset is offered only to the demo Main Admin. */
export default function DemoBanner() {
  const nav = useNavigate();
  const [on, setOn] = useState(isDemo);
  const [, force] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const f = () => { setOn(isDemo()); force((n) => n + 1); };
    window.addEventListener('fb-demo', f);
    window.addEventListener('fb-session', f);
    return () => { window.removeEventListener('fb-demo', f); window.removeEventListener('fb-session', f); };
  }, []);
  if (!on) return null;
  const isAdmin = getSession('staff')?.meta?.role === 'admin';
  return (
    <div className="sticky top-0 z-[60] bg-gradient-to-r from-amber-400 via-amber-300 to-yellow-300 text-amber-950 shadow-sm" role="status" data-testid="demo-banner">
      <div className="safe-x mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-1 py-1.5 text-xs font-semibold sm:text-sm">
        <span className="inline-flex items-center gap-1.5"><FlaskConical className="h-4 w-4" /> DEMO MODE — SAMPLE DATA ONLY</span>
        <span className="ml-auto flex flex-wrap items-center gap-3">
          <Link to="/demo" className="inline-flex items-center gap-1 hover:underline"><Users className="h-4 w-4" /> Switch role</Link>
          {isAdmin && <button type="button" className="inline-flex items-center gap-1 hover:underline" onClick={() => setConfirm(true)}><RotateCcw className="h-4 w-4" /> Reset demo</button>}
          <button type="button" className="inline-flex items-center gap-1 hover:underline" onClick={() => { exitDemo(); nav('/'); }}><LogOut className="h-4 w-4" /> Exit demo</button>
        </span>
      </div>
      <Modal open={confirm} onClose={() => setConfirm(false)} title="Reset the demo?">
        <div className="space-y-4">
          <Notice tone="warn">All demo changes (reports, photos, handovers, edits) are discarded and the original sample data is restored. Real FindBack data is never affected.</Notice>
          <div className="flex gap-2">
            <Button variant="danger" loading={busy} onClick={async () => { setBusy(true); await resetDemo(); setBusy(false); setConfirm(false); nav('/demo'); }}>Reset demo</Button>
            <Button variant="secondary" onClick={() => setConfirm(false)}>Cancel</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
