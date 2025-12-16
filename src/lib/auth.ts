import NextAuth, { type NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import prisma from './prisma';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import type { User } from 'next-auth';
import { securityLogger } from './security-logger';

// Google OAuth profile type
interface GoogleProfile {
  name?: string;
  picture?: string;
  email?: string;
  sub?: string;
}

// Extend the User type to include isAdmin
interface _ExtendedUser extends User {
  isAdmin: boolean;
}

// Extended session type to include additional properties
interface ExtendedSession {
  user: User & {
    id: string;
    isAdmin: boolean;
  };
  expires: string;
}

// Environment variables validation - Auth.js v5 uses AUTH_SECRET
// Support both AUTH_SECRET (preferred) and NEXTAUTH_SECRET (legacy)
const authSecret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
if (!authSecret) {
  console.warn('AUTH_SECRET or NEXTAUTH_SECRET environment variable is missing');
}

if (process.env.NODE_ENV === 'production' && !process.env.NEXTAUTH_URL) {
  console.warn('NEXTAUTH_URL environment variable is missing in production');
}

// Log environment configuration (without sensitive data)
console.log('NextAuth Configuration:', {
  nodeEnv: process.env.NODE_ENV,
  hasSecret: !!authSecret,
  hasUrl: !!process.env.NEXTAUTH_URL,
  url: process.env.NEXTAUTH_URL ? process.env.NEXTAUTH_URL.substring(0, 20) + '...' : 'not set',
  hasAdminEmails: !!process.env.ADMIN_EMAILS
});

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export const authConfig: NextAuthConfig = {
  // Trust the host header - important for Auth.js v5
  trustHost: true,
  secret: authSecret,
  session: {
    strategy: "jwt" as const,
    maxAge: 24 * 60 * 60, // 24 hours
    updateAge: 60 * 60, // 1 hour - refresh session every hour
  },
  jwt: {
    maxAge: 24 * 60 * 60, // 24 hours
  },
  pages: {
    signIn: "/login",
    signOut: "/",
    error: "/login",
  },
  providers: [
    // OAuth Providers
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID || "your-google-client-id",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "your-google-client-secret",
    }),
    // Credentials Provider
    Credentials({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        try {
          // Validate input
          const result = loginSchema.safeParse(credentials);
          if (!result.success) {
            return null;
          }

          const { email, password } = result.data;

          // Find user
          const user = await prisma.user.findUnique({
            where: { email },
          });

          if (!user) {
            securityLogger.logAuthFailure(
              undefined,
              '/api/auth/signin',
              `Failed login attempt - user not found for email: ${email}`
            );
            return null;
          }

          // Verify password - check if user has a password (OAuth users may not have one)
          if (!user.password) {
            securityLogger.logAuthFailure(
              user.id,
              '/api/auth/signin',
              'Failed login attempt - OAuth user attempting credential login'
            );
            return null;
          }

          const isValidPassword = await bcrypt.compare(password, user.password);
          if (!isValidPassword) {
            securityLogger.logAuthFailure(
              user.id,
              '/api/auth/signin',
              'Failed login attempt - invalid password'
            );
            return null;
          }

          // Log successful authentication
          securityLogger.logSecurityEvent({
            type: 'QUIZ_ACCESS',
            userId: user.id,
            endpoint: '/api/auth/signin',
            details: { action: 'successful_login', email: user.email }
          });

          // Check if user is admin
          const adminEmails = process.env.ADMIN_EMAILS?.split(',') || [];
          const isAdmin = adminEmails.includes(user.email);

          return {
            id: user.id,
            email: user.email,
            name: user.name,
            isAdmin,
          };
        } catch (error) {
          console.error('Auth error:', error);
          if (error instanceof PrismaClientKnownRequestError) {
            securityLogger.logAuthFailure(
              undefined,
              '/api/auth/signin',
              `Database error during authentication: ${error.code}`
            );
          }
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider === 'google') {
        try {
          // Cast profile to GoogleProfile for type safety
          const googleProfile = profile as GoogleProfile | undefined;

          // Check if user already exists in database
          const existingUser = await prisma.user.findUnique({
            where: { email: user.email! }
          });

          if (!existingUser) {
            // Create new user for Google OAuth
            const newUser = await prisma.user.create({
              data: {
                email: user.email!,
                name: user.name || googleProfile?.name,
                profilePicture: user.image || googleProfile?.picture,
                // password is optional for OAuth users
              }
            });

            // Update the user object with the database ID
            user.id = newUser.id;

            console.log('Created new Google OAuth user:', newUser.id);
          } else {
            // Update the user object with the existing database ID
            user.id = existingUser.id;

            // Optionally update profile picture if it's new
            if (user.image && user.image !== existingUser.profilePicture) {
              await prisma.user.update({
                where: { id: existingUser.id },
                data: { profilePicture: user.image }
              });
            }

            console.log('Found existing Google OAuth user:', existingUser.id);
          }
        } catch (error) {
          console.error('Error handling Google OAuth user:', error);
          return false; // Prevent sign in on error
        }
      }
      return true;
    },
    async jwt({ token, user, account: _account }) {
      if (user) {
        token.id = user.id;
        token.accessTokenExpires = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

        // Check if user is admin based on email
        const adminEmails = process.env.ADMIN_EMAILS?.split(',') || [];
        token.isAdmin = adminEmails.includes(user.email || '');
      }

      // Ensure expiration is set
      if (!token.accessTokenExpires) {
        token.accessTokenExpires = Date.now() + 24 * 60 * 60 * 1000;
      }

      // Return previous token if the access token has not expired yet
      if (Date.now() < (token.accessTokenExpires as number)) {
        return token;
      }

      // Access token has expired - log and mark as expired without throwing
      securityLogger.logAuthFailure(
        token.id as string,
        '/api/auth/jwt',
        'Token expired, re-authentication required'
      );
      return { ...token, expired: true };
    },
    async session({ session, token }) {
      // If token is expired, return null session to trigger re-auth
      if (token?.expired) {
        return null as unknown as typeof session;
      }

      if (token && session.user) {
        session.user.id = token.id as string;
        // Use unknown intermediate cast for type safety
        (session.user as unknown as { isAdmin: boolean }).isAdmin = token.isAdmin as boolean;
        // Add expiration info to session for client-side handling
        (session as unknown as ExtendedSession).expires = new Date(token.accessTokenExpires as number).toISOString();
      }
      return session;
    },
  },
};

export const { auth, signIn, signOut, handlers } = NextAuth(authConfig);