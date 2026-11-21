import { Check, CircleDot, LockKeyhole, Map } from 'lucide-react';
import DashboardSidebar from '../sharedSidebar/DashboardSidebar';

const BASE = '/dashboard/student';
const preImmersionLinks = [{ to: `${BASE}/pre-immersion/requirements`, label: 'Requirements' }];
const immersionLinks = [
  { path: '', label: 'Daily missions' },
  { path: '/placement-status', label: 'Placement Status' },
  { path: '/attendance', label: 'Attendance' },
  { path: '/daily-documentation', label: 'Daily Documentation' },
].map(({ path, label }) => ({ to: `${BASE}/immersion-proper${path}`, label }));

const stageLinks = [
  { key: 'pre', path: 'pre-immersion', label: 'Pre-Immersion', trail: 'start', children: preImmersionLinks },
  { key: 'immersion', path: 'immersion-proper', label: 'Immersion Proper', trail: 'middle', children: immersionLinks },
  { key: 'post', path: 'post-immersion', label: 'Post-Immersion', trail: 'end' },
];

export default function StudentSidebar({ isOpen, onClose, stages }) {
  const journeyLinks = stageLinks.map(({ key, ...link }) => {
    const status = stages?.[key] ?? (key === 'pre' ? 'available' : 'locked');
    const badge = {
      completed: <Check size={14} aria-label="Completed" />,
      active: <CircleDot size={14} aria-label="Current stage" />,
      locked: <LockKeyhole size={13} aria-label="Locked" />,
    }[status];
    return {
      ...link,
      disabled: status === 'locked',
      badge,
      children: status === 'locked' ? undefined : link.children,
    };
  });
  const links = [
    { path: 'roadmap', label: 'Roadmap', icon: Map, end: true },
    ...journeyLinks,
  ].map(({ path, ...link }) => ({ ...link, to: `${BASE}/${path}` }));

  return <DashboardSidebar title="Student" subtitle="Work Immersion" links={links} isOpen={isOpen} onClose={onClose} />;
}
