import { Archive, BarChart3, Handshake, Inbox, LayoutDashboard, MapPinned, ScrollText, ShieldCheck } from 'lucide-react';
import Console, { type NavItem } from '../staff/Console';

const NAV: NavItem[] = [
  { to: '', label: 'Executive overview', icon: LayoutDashboard },
  { to: 'trends', label: 'Analytics & trends', icon: BarChart3 },
  { to: 'hotspots', label: 'Campus hotspots', icon: MapPinned },
  { to: 'complaints', label: 'Complaints', icon: Inbox },
  { to: 'found', label: 'Found items', icon: Archive },
  { to: 'handovers', label: 'Handovers', icon: Handshake },
  { to: 'audit', label: 'Audit trail', icon: ScrollText },
  { to: 'policies', label: 'Policies & security', icon: ShieldCheck },
];

export default function MgmtLayout() {
  return <Console kind="management" base="/management" nav={NAV} title="Management" />;
}
