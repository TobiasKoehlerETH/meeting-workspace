export const DEFAULT_SUMMARY_LINES = 10;
export const MAX_SUMMARY_LINES = 50;

export function parseSummaryLines(value: unknown): number {
  const count = Number(value);
  return Number.isInteger(count) && count >= 1 && count <= MAX_SUMMARY_LINES
    ? count : DEFAULT_SUMMARY_LINES;
}

export function getSummaryLines(): number {
  if (typeof window === 'undefined') return DEFAULT_SUMMARY_LINES;
  return parseSummaryLines(localStorage.getItem('summaryLines'));
}
