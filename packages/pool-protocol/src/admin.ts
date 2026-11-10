export type AdminEvent = {
  at: number;
  event: string;
  shotId?: string;
  [key: string]: unknown;
};
export type AdminMetrics = {
  summary: {
    games: number;
    shots: number;
    flaggedShots: number;
    clientReports: number;
    correctionCount: number;
    maxCorrection: number;
    recordedBytes: number;
  };
  series: {
    at: number;
    shots: number;
    flagged: number;
    corrections: number;
    maxError: number;
  }[];
  recent: {
    id: string;
    gameId: string;
    tableId: string;
    startedAt: number;
    flags: string[];
  }[];
  errors: AdminEvent[];
  activity: AdminEvent[];
  histogram: [number, number, number, number];
  window: { shots: number; reports: number };
};
