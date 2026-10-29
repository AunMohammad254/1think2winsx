import type { Metadata } from 'next';
import MatchScreen from '@/components/match/MatchScreen';

export const metadata: Metadata = {
  title: 'Live match · 1Think 2Win',
  description: 'Predict what happens in every over of the live match. Free to play.',
};

/** A live match for players (match mode): the screen loads everything from the cached public feed. */
export default async function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MatchScreen matchId={id} />;
}
