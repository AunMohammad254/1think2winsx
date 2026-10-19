import { redirect } from 'next/navigation';

// Prize draws now happen when a quiz is settled (a tie for a place is broken by a recorded random
// draw), and settled quizzes list their winners there, so this old page sends admins to Settle Quizzes.
export default function LuckyWinnerPage() {
    redirect('/admin/quiz-evaluation');
}
