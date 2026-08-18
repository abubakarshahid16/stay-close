/**
 * theme — shared design tokens for Stay Close.
 * A warm, modern palette: violet primary, soft backgrounds, friendly accents.
 */

export const colors = {
  primary: '#7C3AED',
  primaryDark: '#5B21B6',
  primarySoft: '#F1EBFE',
  accent: '#F59E0B',
  success: '#10B981',
  successSoft: '#E7F8F1',
  danger: '#EF4444',
  bg: '#F7F6FB',
  card: '#FFFFFF',
  ink: '#1E1B2E',
  inkSoft: '#6B6880',
  inkFaint: '#A8A5B8',
  line: '#E9E7F2',
};

export const radii = {
  sm: 10,
  md: 14,
  lg: 20,
  pill: 999,
};

export const shadow = {
  card: {
    shadowColor: '#3D2E7C',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
  },
  soft: {
    shadowColor: '#3D2E7C',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
};

/** Palette used for people/circle avatars, chosen for contrast with white text. */
const AVATAR_COLORS = [
  '#7C3AED', // violet
  '#0EA5E9', // sky
  '#10B981', // emerald
  '#F59E0B', // amber
  '#EF4444', // red
  '#EC4899', // pink
  '#14B8A6', // teal
  '#F97316', // orange
];

/** Deterministic color for a name — same name always gets the same color. */
export function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

/** "Ammi Jaan" -> "AJ", "Hamza" -> "H" */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
