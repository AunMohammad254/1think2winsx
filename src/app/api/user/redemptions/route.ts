import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prizeRedemptionDb } from '@/lib/supabase/db';
import { createSecureJsonResponse } from '@/lib/security-headers';

// GET /api/user/redemptions - Get user's prize redemption history
export async function GET() {
  try {
    // Get user session
    const session = await auth();

    if (!session || !session.user) {
      return NextResponse.json(
        { message: 'Unauthorized' },
        { status: 401 }
      );
    }

    const userId = session.user.id;

    // Get user's redemption history
    const redemptions = await prizeRedemptionDb.findByUserId(userId);

    return createSecureJsonResponse({
      success: true,
      data: redemptions,
    }, { status: 200 });

  } catch (error) {
    console.error('Error fetching user redemptions:', error);
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    );
  }
}
