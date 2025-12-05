import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';

// Debug endpoint to check authentication status
// Only available in development or with special debug header
export async function GET(request: NextRequest) {
  // Security check - only allow in development or with debug header
  const isDebugAllowed = process.env.NODE_ENV === 'development' || 
                        request.headers.get('x-debug-auth') === process.env.DEBUG_AUTH_KEY;
  
  if (!isDebugAllowed) {
    return NextResponse.json({ error: 'Debug endpoint not available' }, { status: 404 });
  }

  try {
    const session = await auth();
    
    return NextResponse.json({
      success: true,
      debug: {
        hasSession: !!session,
        hasUser: !!session?.user,
        userId: session?.user?.id,
        userEmail: session?.user?.email,
        isAdmin: session?.user?.isAdmin,
        sessionExpires: session?.expires,
        environment: {
          nodeEnv: process.env.NODE_ENV,
          hasNextAuthUrl: !!process.env.NEXTAUTH_URL,
          hasNextAuthSecret: !!process.env.NEXTAUTH_SECRET,
          hasAdminEmails: !!process.env.ADMIN_EMAILS,
          nextAuthUrl: process.env.NEXTAUTH_URL ? 
            process.env.NEXTAUTH_URL.substring(0, 30) + '...' : 'not set',
          adminEmailsCount: process.env.ADMIN_EMAILS ? 
            process.env.ADMIN_EMAILS.split(',').length : 0
        },
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Debug auth error:', error);
    
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      debug: {
        environment: {
          nodeEnv: process.env.NODE_ENV,
          hasNextAuthUrl: !!process.env.NEXTAUTH_URL,
          hasNextAuthSecret: !!process.env.NEXTAUTH_SECRET,
          hasAdminEmails: !!process.env.ADMIN_EMAILS
        },
        timestamp: new Date().toISOString()
      }
    });
  }
}
