import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { executeCriticalTransaction } from '@/lib/transaction-manager';
import { z } from 'zod';
import { createSecureJsonResponse } from '@/lib/security-headers';
import { requireAuth } from '@/lib/auth-middleware';
import { requireCSRFToken } from '@/lib/csrf-protection';
import { rateLimiters, applyRateLimit } from '@/lib/rate-limiter';
import { recordSecurityEvent } from '@/lib/security-monitoring';

const evaluationSchema = z.object({
  quizId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid quiz ID format'),
  correctAnswers: z.record(z.number().min(0).max(3)) // questionId -> correct option index
});

// POST /api/admin/quiz-evaluation - Add correct answers and evaluate quiz
export async function POST(request: NextRequest) {
  try {
    // Apply CSRF protection
    const csrfValidation = await requireCSRFToken(request);
    if (csrfValidation) {
      return csrfValidation;
    }

    // Require admin authentication
    const authResult = await requireAuth({ adminOnly: true });
    
    if (authResult instanceof NextResponse) {
      return authResult;
    }
    
    const { session } = authResult;

    // Apply rate limiting for admin operations
    const rateLimitResponse = await applyRateLimit(
      rateLimiters.admin,
      request,
      session.user.id,
      '/api/admin/quiz-evaluation'
    );
    if (rateLimitResponse) {
      recordSecurityEvent('RATE_LIMIT_EXCEEDED', request, session.user.id, {
        endpoint: '/api/admin/quiz-evaluation',
        rateLimiter: 'admin'
      });
      return rateLimitResponse;
    }

    const body = await request.json();
    
    // Validate input
    const validationResult = evaluationSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json(
        { message: 'Invalid input data', errors: validationResult.error.errors },
        { status: 400 }
      );
    }
    
    const { quizId, correctAnswers } = validationResult.data;
    
    // Check if quiz exists
    const quiz = await prisma.quiz.findUnique({
      where: { id: quizId },
      include: { 
        questions: true,
        attempts: {
          where: { isEvaluated: false },
          include: { answers: true, user: true }
        }
      }
    });
    
    if (!quiz) {
      return NextResponse.json(
        { message: 'Quiz not found' },
        { status: 404 }
      );
    }
    
    // Validate that all questions have correct answers provided
    const questionIds = quiz.questions.map(q => q.id);
    const missingAnswers = questionIds.filter(id => !(id in correctAnswers));
    
    if (missingAnswers.length > 0) {
      return NextResponse.json(
        { message: 'Missing correct answers for some questions', missingQuestions: missingAnswers },
        { status: 400 }
      );
    }
    
    // Process evaluation in a transaction
    const evaluationResult = await executeCriticalTransaction(async (tx) => {
      // Update questions with correct answers
      for (const [questionId, correctOption] of Object.entries(correctAnswers)) {
        await tx.question.update({
          where: { id: questionId },
          data: { 
            correctOption,
            hasCorrectAnswer: true
          }
        });
      }
      
      // Evaluate all unevaluated quiz attempts
      const evaluatedAttempts = [];
      
      console.log(`[QUIZ_EVALUATION] Starting evaluation for quiz ${quizId} with ${quiz.attempts.length} attempts`);
      
      for (const attempt of quiz.attempts) {
        let score = 0;
        const answerDetails = [];
        
        console.log(`[QUIZ_EVALUATION] Evaluating attempt ${attempt.id} for user ${attempt.user.email}`);
        
        // Update answers with correct/incorrect status
        for (const answer of attempt.answers) {
          const correctOption = correctAnswers[answer.questionId];
          const isCorrect = answer.selectedOption === correctOption;
          
          if (isCorrect) score++;
          
          answerDetails.push({
            questionId: answer.questionId,
            selectedOption: answer.selectedOption,
            correctOption,
            isCorrect
          });
          
          await tx.answer.update({
            where: { id: answer.id },
            data: { isCorrect }
          });
        }
        
        console.log(`[QUIZ_EVALUATION] User ${attempt.user.email} scored ${score}/${quiz.questions.length} (${Math.round((score / quiz.questions.length) * 100)}%)`);
        console.log(`[QUIZ_EVALUATION] Answer breakdown:`, answerDetails);
        
        // Update quiz attempt with score and mark as evaluated
        const scorePercentage = Math.round((score / quiz.questions.length) * 100);
        
        await tx.quizAttempt.update({
          where: { id: attempt.id },
          data: {
            score: scorePercentage,
            isEvaluated: true
          }
        });
        
        evaluatedAttempts.push({
          userId: attempt.userId,
          userEmail: attempt.user.email,
          score,
          totalQuestions: quiz.questions.length,
          percentage: Math.round((score / quiz.questions.length) * 100)
        });
      }
      
      console.log(`[QUIZ_EVALUATION] Completed evaluation for ${evaluatedAttempts.length} attempts`);
      
      return evaluatedAttempts;
    }, {
      context: 'quiz_evaluation',
      userId: session.user.id,
      description: `Quiz evaluation for quiz ${quizId}`
    });
    
    return createSecureJsonResponse({
      success: true,
      message: 'Quiz evaluated successfully',
      evaluatedAttempts: evaluationResult.length,
      results: evaluationResult
    }, { status: 200 });
    
  } catch (error) {
    console.error('Error evaluating quiz:', error);
    
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    );
  }
}

// GET /api/admin/quiz-evaluation/[quizId] - Get quiz evaluation status
export async function GET(request: NextRequest) {
  try {
    // Require admin authentication
    const authResult = await requireAuth({ adminOnly: true });
    
    if (authResult instanceof NextResponse) {
      return authResult;
    }
    
    const { session } = authResult;

    // Apply rate limiting for admin operations
    const rateLimitResponse = await applyRateLimit(
      rateLimiters.admin,
      request,
      session.user.id,
      '/api/admin/quiz-evaluation'
    );
    if (rateLimitResponse) {
      recordSecurityEvent('RATE_LIMIT_EXCEEDED', request, session.user.id, {
        endpoint: '/api/admin/quiz-evaluation',
        rateLimiter: 'admin',
        method: 'GET'
      });
      return rateLimitResponse;
    }
    
    const url = new URL(request.url);
    const quizId = url.searchParams.get('quizId');
    
    if (!quizId) {
      return NextResponse.json(
        { message: 'Quiz ID is required' },
        { status: 400 }
      );
    }
    
    // Get quiz with evaluation status
    const quiz = await prisma.quiz.findUnique({
      where: { id: quizId },
      include: {
        questions: {
          select: {
            id: true,
            text: true,
            options: true,
            correctOption: true,
            hasCorrectAnswer: true
          }
        },
        attempts: {
          select: {
            id: true,
            userId: true,
            score: true,
            isEvaluated: true,
            createdAt: true,
            user: {
              select: {
                email: true,
                name: true
              }
            }
          }
        }
      }
    });
    
    if (!quiz) {
      return NextResponse.json(
        { message: 'Quiz not found' },
        { status: 404 }
      );
    }
    
    const totalAttempts = quiz.attempts.length;
    const evaluatedAttempts = quiz.attempts.filter(a => a.isEvaluated).length;
    const pendingAttempts = totalAttempts - evaluatedAttempts;
    
    return createSecureJsonResponse({
      quiz: {
        id: quiz.id,
        title: quiz.title,
        totalQuestions: quiz.questions.length,
        questionsWithAnswers: quiz.questions.filter(q => q.hasCorrectAnswer).length
      },
      evaluation: {
        totalAttempts,
        evaluatedAttempts,
        pendingAttempts,
        isFullyEvaluated: pendingAttempts === 0 && quiz.questions.every(q => q.hasCorrectAnswer)
      },
      questions: quiz.questions,
      attempts: quiz.attempts
    }, { status: 200 });
    
  } catch (error) {
    console.error('Error getting quiz evaluation status:', error);
    
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    );
  }
}