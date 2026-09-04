export const retentionPolicy = Object.freeze({
  oauthSessionTtlMinutes: 10,
  oauthSessionCleanupHours: 24,
  normalizedDailyMetricsDays: 365,
  sleepStageSegmentsDays: 90,
  syncAttemptsDays: 14,
  disconnectedConnectionMetadataDays: 30,
  deletedMemberDataCleanupHours: 24,
});

export type RetentionPolicy = typeof retentionPolicy;
