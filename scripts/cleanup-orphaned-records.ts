/**
 * Script to clean up orphaned records in the database
 * These are records that reference deleted entities (quizzes, questions, etc.)
 * Run this script periodically to maintain database integrity
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function cleanupOrphanedRecords() {
  console.log('Starting cleanup of orphaned records...');
  
  try {
    // 1. Clean up QuizAttempts that reference non-existent quizzes
    console.log('\n1. Checking for orphaned QuizAttempts...');
    
    // Get all quiz IDs
    const allQuizzes = await prisma.quiz.findMany({
      select: { id: true }
    });
    const validQuizIds = new Set(allQuizzes.map(q => q.id));
    
    // Find quiz attempts with invalid quiz IDs
    const allQuizAttempts = await prisma.quizAttempt.findMany({
      select: { id: true, quizId: true }
    });
    
    const orphanedAttemptIds = allQuizAttempts
      .filter(attempt => !validQuizIds.has(attempt.quizId))
      .map(attempt => attempt.id);
    
    if (orphanedAttemptIds.length > 0) {
      console.log(`Found ${orphanedAttemptIds.length} orphaned quiz attempts. Deleting...`);
      const result = await prisma.quizAttempt.deleteMany({
        where: {
          id: { in: orphanedAttemptIds }
        }
      });
      console.log(`Deleted ${result.count} orphaned quiz attempts`);
    } else {
      console.log('No orphaned quiz attempts found');
    }
    
    // 2. Clean up Answers that reference non-existent questions
    console.log('\n2. Checking for orphaned Answers...');
    
    const allQuestions = await prisma.question.findMany({
      select: { id: true }
    });
    const validQuestionIds = new Set(allQuestions.map(q => q.id));
    
    const allAnswers = await prisma.answer.findMany({
      select: { id: true, questionId: true }
    });
    
    const orphanedAnswerIds = allAnswers
      .filter(answer => !validQuestionIds.has(answer.questionId))
      .map(answer => answer.id);
    
    if (orphanedAnswerIds.length > 0) {
      console.log(`Found ${orphanedAnswerIds.length} orphaned answers. Deleting...`);
      const result = await prisma.answer.deleteMany({
        where: {
          id: { in: orphanedAnswerIds }
        }
      });
      console.log(`Deleted ${result.count} orphaned answers`);
    } else {
      console.log('No orphaned answers found');
    }
    
    // 3. Clean up Winnings that reference non-existent quizzes
    console.log('\n3. Checking for orphaned Winnings...');
    
    const allWinnings = await prisma.winning.findMany({
      select: { id: true, quizId: true }
    });
    
    const orphanedWinningIds = allWinnings
      .filter(winning => !validQuizIds.has(winning.quizId))
      .map(winning => winning.id);
    
    if (orphanedWinningIds.length > 0) {
      console.log(`Found ${orphanedWinningIds.length} orphaned winnings. Deleting...`);
      const result = await prisma.winning.deleteMany({
        where: {
          id: { in: orphanedWinningIds }
        }
      });
      console.log(`Deleted ${result.count} orphaned winnings`);
    } else {
      console.log('No orphaned winnings found');
    }
    
    // 4. Clean up Payments that are not referenced by any quiz attempts
    console.log('\n4. Checking for orphaned Payments...');
    
    // Get all payment IDs that are referenced by quiz attempts
    const referencedPayments = await prisma.quizAttempt.findMany({
      select: { paymentId: true },
      where: { paymentId: { not: null } }
    });
    const referencedPaymentIds = new Set(
      referencedPayments
        .map(attempt => attempt.paymentId)
        .filter(id => id !== null) as string[]
    );
    
    const allPayments = await prisma.payment.findMany({
      select: { id: true }
    });
    
    const orphanedPaymentIds = allPayments
      .filter(payment => !referencedPaymentIds.has(payment.id))
      .map(payment => payment.id);
    
    if (orphanedPaymentIds.length > 0) {
      console.log(`Found ${orphanedPaymentIds.length} orphaned payments. Deleting...`);
      const result = await prisma.payment.deleteMany({
        where: {
          id: { in: orphanedPaymentIds }
        }
      });
      console.log(`Deleted ${result.count} orphaned payments`);
    } else {
      console.log('No orphaned payments found');
    }
    
    // 5. Clean up Questions without quizzes
    console.log('\n5. Checking for orphaned Questions...');
    
    const allQuestionsWithQuiz = await prisma.question.findMany({
      select: { id: true, quizId: true }
    });
    
    const orphanedQuestionIds = allQuestionsWithQuiz
      .filter(question => !validQuizIds.has(question.quizId))
      .map(question => question.id);
    
    if (orphanedQuestionIds.length > 0) {
      console.log(`Found ${orphanedQuestionIds.length} orphaned questions. Deleting...`);
      const result = await prisma.question.deleteMany({
        where: {
          id: { in: orphanedQuestionIds }
        }
      });
      console.log(`Deleted ${result.count} orphaned questions`);
    } else {
      console.log('No orphaned questions found');
    }
    
    console.log('\n✅ Cleanup completed successfully!');
    
  } catch (error) {
    console.error('Error during cleanup:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the cleanup
cleanupOrphanedRecords();