'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, BarChart3, Users, Clock } from "lucide-react";

interface QuizAttempt {
  id: string;
  userId: string;
  userName: string;
  score: number;
  totalQuestions: number;
  timeSpent: number;
  createdAt: string;
}

interface QuestionStat {
  id: string;
  text: string;
  correctAnswers: number;
  totalAnswers: number;
  percentageCorrect: number;
  answerDistribution: number[];
}

interface QuizQuestion {
  id: string;
  text: string;
  options: string[];
  correctOption: number | null;
  hasCorrectAnswer: boolean;
  status: string;
  createdAt: string;
  updatedAt: string;
  stats?: {
    correctAnswers: number;
    totalAnswers: number;
    percentageCorrect: number;
    answerDistribution: number[];
  };
}

interface QuizStatistics {
  totalAttempts: number;
  averageScore: number;
  highestScore: number;
  lowestScore: number;
  averageTimeSpent: number;
  questionStats: QuestionStat[];
  recentAttempts: QuizAttempt[];
  scoreDistribution: {
    range: string;
    count: number;
  }[];
}

interface QuizStatisticsProps {
  quizId: string;
}

export default function QuizStatistics({ quizId }: QuizStatisticsProps) {
  const [statistics, setStatistics] = useState<QuizStatistics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchStatistics = async () => {
      setIsLoading(true);
      setError(null);
      
      try {
        const response = await fetch(`/api/admin/quizzes/${quizId}`);
        
        if (!response.ok) {
          throw new Error('Failed to fetch quiz statistics');
        }
        
        const data = await response.json();
        
        // Transform data into the format we need
        const stats: QuizStatistics = {
          totalAttempts: data.stats.totalAttempts || 0,
          averageScore: data.stats.averageScore || 0,
          highestScore: data.stats.maxScore || 0,
          lowestScore: data.stats.minScore || 0,
          averageTimeSpent: data.stats.averageTimeSpent || 0,
          questionStats: data.questions.map((q: QuizQuestion) => ({
            id: q.id,
            text: q.text,
            correctAnswers: q.stats?.correctAnswers || 0,
            totalAnswers: q.stats?.totalAnswers || 0,
            percentageCorrect: q.stats?.percentageCorrect || 0,
            answerDistribution: q.stats?.answerDistribution || []
          })),
          recentAttempts: data.recentAttempts || [],
          scoreDistribution: data.stats.scoreDistribution || [
            { range: '0-20%', count: 0 },
            { range: '21-40%', count: 0 },
            { range: '41-60%', count: 0 },
            { range: '61-80%', count: 0 },
            { range: '81-100%', count: 0 }
          ]
        };
        
        setStatistics(stats);
      } catch (err) {
        console.error('Error fetching quiz statistics:', err);
        setError(err instanceof Error ? err.message : 'An unknown error occurred');
      } finally {
        setIsLoading(false);
      }
    };
    
    if (quizId) {
      fetchStatistics();
    }
  }, [quizId]);

  // Format time in seconds to minutes:seconds
  const formatTime = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.round(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  // Format date
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <p className="text-destructive">Error: {error}</p>
        </CardContent>
      </Card>
    );
  }

  if (!statistics || statistics.totalAttempts === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <p className="text-muted-foreground">No quiz attempts recorded yet</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="questions">Questions</TabsTrigger>
          <TabsTrigger value="attempts">Recent Attempts</TabsTrigger>
        </TabsList>
        
        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Total Attempts</CardDescription>
                <CardTitle className="text-2xl flex items-center">
                  <Users className="mr-2 h-5 w-5 text-muted-foreground" />
                  {statistics.totalAttempts}
                </CardTitle>
              </CardHeader>
            </Card>
            
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Average Score</CardDescription>
                <CardTitle className="text-2xl flex items-center">
                  <BarChart3 className="mr-2 h-5 w-5 text-muted-foreground" />
                  {Math.round(statistics.averageScore)}%
                </CardTitle>
              </CardHeader>
            </Card>
            
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Highest Score</CardDescription>
                <CardTitle className="text-2xl flex items-center">
                  <BarChart3 className="mr-2 h-5 w-5 text-green-500" />
                  {Math.round(statistics.highestScore)}%
                </CardTitle>
              </CardHeader>
            </Card>
            
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Average Time</CardDescription>
                <CardTitle className="text-2xl flex items-center">
                  <Clock className="mr-2 h-5 w-5 text-muted-foreground" />
                  {formatTime(statistics.averageTimeSpent)}
                </CardTitle>
              </CardHeader>
            </Card>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Score Distribution</CardTitle>
                <CardDescription>Breakdown of scores across all attempts</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {statistics.scoreDistribution.map((range) => (
                    <div key={range.range} className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span>{range.range}</span>
                        <span>{range.count} attempts</span>
                      </div>
                      <div className="h-2 rounded-full bg-secondary overflow-hidden">
                        <div 
                          className="h-full bg-primary" 
                          style={{ 
                            width: `${statistics.totalAttempts > 0 
                              ? (range.count / statistics.totalAttempts) * 100 
                              : 0}%` 
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader>
                <CardTitle>Performance Summary</CardTitle>
                <CardDescription>Overall quiz performance metrics</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Score Range</p>
                    <p className="font-medium">{Math.round(statistics.lowestScore)}% - {Math.round(statistics.highestScore)}%</p>
                  </div>
                  
                  <div>
                    <p className="text-sm text-muted-foreground">Pass Rate (&gt;60%)</p>
                    {/* Calculate pass rate based on score distribution */}
                    <p className="font-medium">
                      {Math.round(
                        ((statistics.scoreDistribution[3]?.count || 0) + 
                         (statistics.scoreDistribution[4]?.count || 0)) / 
                        statistics.totalAttempts * 100
                      )}%
                    </p>
                  </div>
                  
                  <div>
                    <p className="text-sm text-muted-foreground">Most Challenging Questions</p>
                    <div className="space-y-2 mt-2">
                      {statistics.questionStats
                        .sort((a, b) => a.percentageCorrect - b.percentageCorrect)
                        .slice(0, 3)
                        .map((question) => (
                          <div key={question.id} className="text-sm">
                            <p className="truncate">{question.text}</p>
                            <div className="flex justify-between">
                              <span className="text-xs text-muted-foreground">
                                {question.correctAnswers} / {question.totalAnswers} correct
                              </span>
                              <span className="text-xs font-medium">
                                {Math.round(question.percentageCorrect)}%
                              </span>
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
        
        <TabsContent value="questions" className="space-y-4">
          {statistics.questionStats.map((question) => (
            <Card key={question.id}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{question.text}</CardTitle>
                <CardDescription>
                  {question.correctAnswers} out of {question.totalAnswers} answers correct ({Math.round(question.percentageCorrect)}%)
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {question.answerDistribution.map((count, index) => (
                    <div key={index} className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span>Option {index + 1}</span>
                        <span>{count} selections</span>
                      </div>
                      <div className="h-2 rounded-full bg-secondary overflow-hidden">
                        <div 
                          className={`h-full ${index === question.answerDistribution.indexOf(Math.max(...question.answerDistribution)) 
                            ? 'bg-primary' 
                            : 'bg-muted'}`} 
                          style={{ 
                            width: `${question.totalAnswers > 0 
                              ? (count / question.totalAnswers) * 100 
                              : 0}%` 
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>
        
        <TabsContent value="attempts" className="space-y-4">
          {statistics.recentAttempts.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-4">User</th>
                    <th className="text-left py-3 px-4">Score</th>
                    <th className="text-left py-3 px-4">Time Spent</th>
                    <th className="text-left py-3 px-4">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {statistics.recentAttempts.map((attempt) => (
                    <tr key={attempt.id} className="border-b hover:bg-muted/50">
                      <td className="py-3 px-4">{attempt.userName || 'Anonymous'}</td>
                      <td className="py-3 px-4">
                        {Math.round((attempt.score / attempt.totalQuestions) * 100)}%
                        <span className="text-xs text-muted-foreground ml-1">
                          ({attempt.score}/{attempt.totalQuestions})
                        </span>
                      </td>
                      <td className="py-3 px-4">{formatTime(attempt.timeSpent)}</td>
                      <td className="py-3 px-4">{formatDate(attempt.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <p className="text-muted-foreground">No recent attempts recorded</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}