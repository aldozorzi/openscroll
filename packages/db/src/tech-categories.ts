export const TECH_SOURCE_CATEGORIES = [
  'Programming',
  'Tech',
  'technology',
  'Cyber security',
  'Web Development',
  'Android Development',
  'iOS Development',
  'UI / UX',
  'Computer Science',
  'Software Engineering',
  'Data Science',
  'Artificial Intelligence',
  'Machine Learning',
  'Cloud',
  'DevOps',
  'Linux',
  'Open Source',
  'Hardware',
  'Developer Tools',
] as const;

const TECH_CATEGORY_SET = new Set(
  TECH_SOURCE_CATEGORIES.map((category) => category.toLowerCase()),
);

export function isTechSourceCategory(
  category: string | null | undefined,
): boolean {
  return category ? TECH_CATEGORY_SET.has(category.trim().toLowerCase()) : false;
}
