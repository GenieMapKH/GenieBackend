/** Why something is reported. The same list as the database's CHECK (migration 30). */
export const REPORT_REASONS = [
  'spam',
  'scam',
  'misleading',
  'inappropriate',
  'duplicate',
  'unavailable',
  'harassment',
  'impersonation',
  'other',
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number];

/** What can be reported. A message is reported as its sender: the server cannot read it. */
export const REPORT_TARGETS = ['listing', 'user'] as const;

export type ReportTarget = (typeof REPORT_TARGETS)[number];

/** Where a report is in its review. */
export const REVIEW_OUTCOMES = ['resolved', 'dismissed'] as const;

export const REPORT_STATUSES = ['open', ...REVIEW_OUTCOMES] as const;
