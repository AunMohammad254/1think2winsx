export type LeaderboardEntry = {
  id: string;
  rank: number;
  userName: string;
  quizzesTaken: number;
  correctAnswers: number;
  totalScore: number;
  winCount: number;
  averageScore?: number;
};

export type PrevData = Map<string, { rank: number; score: number }>;
