/**
 * Script to clean up orphaned records in the database
 * These are records that reference deleted entities (quizzes, questions, etc.)
 * Run this script periodically to maintain database integrity
 * 
 * Usage: npx tsx scripts/cleanup-orphaned-records.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function cleanupOrphanedRecords() {
  console.log('Starting cleanup of orphaned records...');

  try {
    // 1. Clean up QuizAttempts that reference non-existent quizzes
    console.log('\n1. Checking for orphaned QuizAttempts...');

    const { data: allQuizzes } = await supabase
      .from('Quiz')
      .select('id');
    const validQuizIds = new Set((allQuizzes || []).map(q => q.id));

    const { data: allQuizAttempts } = await supabase
      .from('QuizAttempt')
      .select('id, quizId');

    const orphanedAttemptIds = (allQuizAttempts || [])
      .filter(attempt => !validQuizIds.has(attempt.quizId))
      .map(attempt => attempt.id);

    if (orphanedAttemptIds.length > 0) {
      console.log(`Found ${orphanedAttemptIds.length} orphaned quiz attempts. Deleting...`);
      const { error } = await supabase
        .from('QuizAttempt')
        .delete()
        .in('id', orphanedAttemptIds);
      if (error) throw error;
      console.log(`Deleted ${orphanedAttemptIds.length} orphaned quiz attempts`);
    } else {
      console.log('No orphaned quiz attempts found');
    }

    // 2. Clean up Answers that reference non-existent questions
    console.log('\n2. Checking for orphaned Answers...');

    const { data: allQuestions } = await supabase
      .from('Question')
      .select('id');
    const validQuestionIds = new Set((allQuestions || []).map(q => q.id));

    const { data: allAnswers } = await supabase
      .from('Answer')
      .select('id, questionId');

    const orphanedAnswerIds = (allAnswers || [])
      .filter(answer => !validQuestionIds.has(answer.questionId))
      .map(answer => answer.id);

    if (orphanedAnswerIds.length > 0) {
      console.log(`Found ${orphanedAnswerIds.length} orphaned answers. Deleting...`);
      const { error } = await supabase
        .from('Answer')
        .delete()
        .in('id', orphanedAnswerIds);
      if (error) throw error;
      console.log(`Deleted ${orphanedAnswerIds.length} orphaned answers`);
    } else {
      console.log('No orphaned answers found');
    }

    // 3. Clean up Winnings that reference non-existent quizzes
    console.log('\n3. Checking for orphaned Winnings...');

    const { data: allWinnings } = await supabase
      .from('Winning')
      .select('id, quizId');

    const orphanedWinningIds = (allWinnings || [])
      .filter(winning => !validQuizIds.has(winning.quizId))
      .map(winning => winning.id);

    if (orphanedWinningIds.length > 0) {
      console.log(`Found ${orphanedWinningIds.length} orphaned winnings. Deleting...`);
      const { error } = await supabase
        .from('Winning')
        .delete()
        .in('id', orphanedWinningIds);
      if (error) throw error;
      console.log(`Deleted ${orphanedWinningIds.length} orphaned winnings`);
    } else {
      console.log('No orphaned winnings found');
    }

    // 4. Clean up Questions without quizzes
    console.log('\n4. Checking for orphaned Questions...');

    const { data: allQuestionsWithQuiz } = await supabase
      .from('Question')
      .select('id, quizId');

    const orphanedQuestionIds = (allQuestionsWithQuiz || [])
      .filter(question => !validQuizIds.has(question.quizId))
      .map(question => question.id);

    if (orphanedQuestionIds.length > 0) {
      console.log(`Found ${orphanedQuestionIds.length} orphaned questions. Deleting...`);
      const { error } = await supabase
        .from('Question')
        .delete()
        .in('id', orphanedQuestionIds);
      if (error) throw error;
      console.log(`Deleted ${orphanedQuestionIds.length} orphaned questions`);
    } else {
      console.log('No orphaned questions found');
    }

    console.log('\n✅ Cleanup completed successfully!');

  } catch (error) {
    console.error('Error during cleanup:', error);
  }
}

// Run the cleanup
cleanupOrphanedRecords();