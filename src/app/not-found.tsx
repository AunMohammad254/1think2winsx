import type { Metadata } from 'next';
import Link from 'next/link';
import { Home, SearchX, Trophy } from 'lucide-react';
import ErrorCard, { primaryActionClass, secondaryActionClass } from '@/components/errors/ErrorCard';

export const metadata: Metadata = {
    title: 'Page not found | 1Think 2Win',
};

/** Any URL the site doesn't have, and any page that calls notFound(). */
export default function NotFound() {
    return (
        <ErrorCard
            code="404"
            icon={<SearchX className="w-10 h-10" />}
            title="Page not found"
            message="The page you're looking for doesn't exist or has moved. Check the address, or pick up where the action is."
        >
            <Link href="/quizzes" prefetch={false} className={primaryActionClass}>
                <Trophy className="w-5 h-5" />
                Browse quizzes
            </Link>
            <Link href="/" className={secondaryActionClass}>
                <Home className="w-5 h-5" />
                Go Home
            </Link>
        </ErrorCard>
    );
}
