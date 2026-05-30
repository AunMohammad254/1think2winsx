import { NextRequest } from 'next/server';
import { ImageResponse } from 'next/og';
import { getAdminDb } from '@/lib/supabase/db';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: attemptId } = await params;
    const { searchParams } = new URL(request.url);

    // Retrieve parameters or use fallbacks
    let score = searchParams.get('score');
    let total = searchParams.get('total');
    let pct = searchParams.get('pct');
    let title = searchParams.get('title') || 'Cricket Quiz';
    let name = searchParams.get('name') || 'Cricket Fan';

    // If attemptId is not placeholder, try to load real data from database
    if (attemptId && attemptId !== 'temp') {
      try {
        const adminDb = getAdminDb();
        
        // Fetch the quiz attempt bypassing RLS
        const { data: attempt } = await adminDb
          .from('QuizAttempt')
          .select('score, userId, quizId')
          .eq('id', attemptId)
          .single();

        if (attempt) {
          // Fetch quiz details
          const { data: quiz } = await adminDb
            .from('Quiz')
            .select('title')
            .eq('id', attempt.quizId)
            .single();

          // Fetch user details
          const { data: user } = await adminDb
            .from('User')
            .select('name, email')
            .eq('id', attempt.userId)
            .single();

          // Fetch total questions for this quiz
          const { count } = await adminDb
            .from('Question')
            .select('*', { count: 'exact', head: true })
            .eq('quizId', attempt.quizId);

          if (quiz) {
            title = quiz.title;
          }
          if (user) {
            name = user.name || user.email.split('@')[0] || name;
          }
          if (attempt.score !== undefined) {
            const totalQs = count || 10;
            score = attempt.score.toString();
            total = totalQs.toString();
            pct = Math.round((attempt.score / (totalQs * 10)) * 100).toString();
          }
        }
      } catch (dbErr) {
        console.error('[Share Card] Error fetching real db attempt data:', dbErr);
        // Fall back to query parameters
      }
    }

    // Default calculations if parameters are empty
    const finalScore = score ? parseInt(score) : 8;
    const finalTotal = total ? parseInt(total) : 10;
    const finalPct = pct ? parseInt(pct) : Math.round((finalScore / finalTotal) * 100);

    const getScoreColor = (p: number) => {
      if (p >= 80) return '#4ade80'; // Emerald/Green
      if (p >= 60) return '#facc15'; // Yellow
      return '#f87171'; // Red
    };

    const getPerformanceLevel = (p: number) => {
      if (p >= 90) return 'Excellent';
      if (p >= 80) return 'Very Good';
      if (p >= 70) return 'Good';
      if (p >= 60) return 'Average';
      return 'Needs Practice';
    };

    return new ImageResponse(
      (
        <div
          style={{
            height: '100%',
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#090d16',
            backgroundImage: 'radial-gradient(circle at center, #151b2d 0%, #090d16 100%)',
            padding: '40px',
            border: '8px solid #1e293b',
          }}
        >
          {/* Inner Glowing Border */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              width: '100%',
              height: '100%',
              border: '2px solid rgba(59, 130, 246, 0.2)',
              borderRadius: '24px',
              padding: '40px',
              justifyContent: 'space-between',
              position: 'relative',
            }}
          >
            {/* Background elements */}
            <div
              style={{
                position: 'absolute',
                top: -50,
                right: -50,
                width: '200px',
                height: '200px',
                borderRadius: '100px',
                backgroundColor: 'rgba(139, 92, 246, 0.1)',
                filter: 'blur(40px)',
              }}
            />
            <div
              style={{
                position: 'absolute',
                bottom: -50,
                left: -50,
                width: '200px',
                height: '200px',
                borderRadius: '100px',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                filter: 'blur(40px)',
              }}
            />

            {/* Header Branding */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                width: '100%',
              }}
            >
              <span
                style={{
                  fontSize: '28px',
                  fontWeight: 'bold',
                  color: '#ffffff',
                  letterSpacing: '1px',
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                🏏 1Think2Win
              </span>
              <span
                style={{
                  fontSize: '14px',
                  color: '#94a3b8',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '30px',
                  padding: '6px 16px',
                  backgroundColor: 'rgba(255, 255, 255, 0.05)',
                }}
              >
                CRICKET QUIZ ARENA
              </span>
            </div>

            {/* Main Score Info */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: '100%',
                margin: '20px 0',
              }}
            >
              {/* Left text column */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  flex: '1',
                }}
              >
                <span
                  style={{
                    fontSize: '20px',
                    color: '#3b82f6',
                    fontWeight: 'bold',
                    textTransform: 'uppercase',
                    letterSpacing: '2px',
                  }}
                >
                  Challenge Completed
                </span>
                <span
                  style={{
                    fontSize: '48px',
                    fontWeight: 'bold',
                    color: '#ffffff',
                    marginTop: '8px',
                    lineHeight: '1.2',
                  }}
                >
                  {name}
                </span>
                <span
                  style={{
                    fontSize: '22px',
                    color: '#94a3b8',
                    marginTop: '8px',
                  }}
                >
                  Completed quiz: &ldquo;{title}&rdquo;
                </span>
              </div>

              {/* Circular Percentage Score */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '200px',
                  height: '200px',
                  borderRadius: '100px',
                  border: `8px solid ${getScoreColor(finalPct)}`,
                  backgroundColor: 'rgba(15, 23, 42, 0.6)',
                  boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.3)',
                }}
              >
                <span
                  style={{
                    fontSize: '54px',
                    fontWeight: 'bold',
                    color: getScoreColor(finalPct),
                  }}
                >
                  {finalPct}%
                </span>
                <span
                  style={{
                    fontSize: '14px',
                    color: '#ffffff',
                    fontWeight: 'bold',
                    textTransform: 'uppercase',
                    letterSpacing: '1px',
                    marginTop: '4px',
                  }}
                >
                  Accuracy
                </span>
              </div>
            </div>

            {/* Metrics Breakdown row */}
            <div
              style={{
                display: 'flex',
                gap: '24px',
                width: '100%',
              }}
            >
              {/* Box 1 */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  backgroundColor: 'rgba(30, 41, 59, 0.4)',
                  border: '1px solid rgba(255,255,255,0.05)',
                  borderRadius: '16px',
                  padding: '16px 28px',
                  flex: '1',
                }}
              >
                <span style={{ fontSize: '14px', color: '#94a3b8' }}>Correct Answers</span>
                <span style={{ fontSize: '28px', fontWeight: 'bold', color: '#4ade80', marginTop: '4px' }}>
                  {finalScore} / {finalTotal}
                </span>
              </div>

              {/* Box 2 */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  backgroundColor: 'rgba(30, 41, 59, 0.4)',
                  border: '1px solid rgba(255,255,255,0.05)',
                  borderRadius: '16px',
                  padding: '16px 28px',
                  flex: '1',
                }}
              >
                <span style={{ fontSize: '14px', color: '#94a3b8' }}>Rating</span>
                <span style={{ fontSize: '28px', fontWeight: 'bold', color: '#60a5fa', marginTop: '4px' }}>
                  {getPerformanceLevel(finalPct)}
                </span>
              </div>

              {/* Box 3 */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  backgroundColor: 'rgba(30, 41, 59, 0.4)',
                  border: '1px solid rgba(255,255,255,0.05)',
                  borderRadius: '16px',
                  padding: '16px 28px',
                  flex: '1',
                }}
              >
                <span style={{ fontSize: '14px', color: '#94a3b8' }}>Challenge Status</span>
                <span style={{ fontSize: '28px', fontWeight: 'bold', color: '#c084fc', marginTop: '4px' }}>
                  Verified 🏆
                </span>
              </div>
            </div>

            {/* Footer */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                width: '100%',
                borderTop: '1px solid rgba(255, 255, 255, 0.1)',
                paddingTop: '16px',
              }}
            >
              <span style={{ fontSize: '14px', color: '#64748b' }}>
                Join the arena &bull; Answer correctly &bull; Win exciting real prizes!
              </span>
              <span style={{ fontSize: '14px', fontWeight: 'bold', color: '#ffffff' }}>
                www.1think2wins.com
              </span>
            </div>
          </div>
        </div>
      ),
      {
        width: 1200,
        height: 630,
      }
    );
  } catch (err: any) {
    console.error('[Share Card Generator] Error:', err);
    return new Response('Failed to generate image', { status: 500 });
  }
}
