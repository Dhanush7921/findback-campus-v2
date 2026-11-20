import { Activity, Archive, BarChart3, ClipboardCheck, Handshake, IdCard, Inbox, LayoutDashboard, PackagePlus, Search, Settings, Sparkles, UsersRound } from 'lucide-react';
import Console, { type NavItem } from './Console';

const NAV: NavItem[] = [
  { to: '', label: 'Dashboard', icon: LayoutDashboard },
  { to: 'register', label: 'Register found item', icon: PackagePlus },
  { to: 'inventory', label: 'Found inventory', icon: Archive },
  { to: 'complaints', label: 'Complaints', icon: Inbox },
  { to: 'matching', label: 'Matching & review', icon: Sparkles },
  { to: 'claims', label: 'Claim verification', icon: ClipboardCheck },
  { to: 'handovers', label: 'Handovers', icon: Handshake },
  { to: 'unclaimed', label: 'Unclaimed items', icon: Search },
  { to: 'registry', label: 'Student registry & guests', icon: IdCard },
  { to: 'people', label: 'Staff & permissions', icon: UsersRound },
  { to: 'activity', label: 'Audit log', icon: Activity },
  { to: 'analytics', label: 'Reports', icon: BarChart3 },
  { to: 'settings', label: 'System settings', icon: Settings },
];

export default function StaffLayout() {
  return <Console kind="admin" base="/staff" nav={NAV} title="Main Admin" />;
}
