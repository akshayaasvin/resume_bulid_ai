import type { Badge, SkillLevel } from '@/lib/scoring';

const LEVEL_CLS: Record<SkillLevel, string> = {
  advanced: 'bg-green-100 text-green-800',
  intermediate: 'bg-blue-100 text-blue-800',
  beginner: 'bg-slate-100 text-slate-800',
  needs_improvement: 'bg-amber-100 text-amber-800',
};

export function LevelChip({ level, label }: { level: SkillLevel; label: string }) {
  return <span className={`chip ${LEVEL_CLS[level]}`}>{label}</span>;
}

export function BadgeChip({ badge, label }: { badge: Badge; label: string }) {
  if (badge === 'campus_verified') return <span className="chip bg-brand-600 text-white">✓ {label}</span>;
  if (badge === 'verified') return <span className="chip bg-brand-100 text-brand-800">✓ {label}</span>;
  return <span className="chip bg-slate-100 text-slate-600">{label}</span>;
}
