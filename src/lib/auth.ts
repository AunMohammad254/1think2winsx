import NextAuth, { type NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';
import * as bcrypt from 'bcrypt';
import { z } from 'zod';
import prisma from './prisma';
import { Prisma } from '@prisma/client';
import type { JWT as _JWT } from 'next-auth/jwt';
import type { Session as _Session, User, Account as _Account } from 'next-auth';
import { securityLogger } from './security-logger';

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

// Environment variables validation
if (!process.env.NEXTAUTH_SECRET) {
  console.error('NEXTAUTH_SECRET environment variable is required');
  throw new Error('NEXTAUTH_SECRET environment variable is required');
}

// NEXTAUTH_URL is required in production
if (process.env.NODE_ENV === 'production' && !process.env.NEXTAUTH_URL) {
  console.error('NEXTAUTH_URL environment variable is required in production');
  throw new Error('NEXTAUTH_URL environment variable is required in production');
}

// Log environment configuration (without sensitive data)
console.log('NextAuth Configuration:', {
  nodeEnv: process.env.NODE_ENV,
  hasSecret: !!process.env.NEXTAUTH_SECRET,
  hasUrl: !!process.env.NEXTAUTH_URL,
  url: process.env.NEXTAUTH_URL ? process.env.NEXTAUTH_URL.substring(0, 20) + '...' : 'not set',
  hasAdminEmails: !!process.env.ADMIN_EMAILS
});

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export const authConfig: NextAuthConfig = {
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
          if (error instanceof Prisma.PrismaClientKnownRequestError) {
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
          // Check if user already exists in database
          const existingUser = await prisma.user.findUnique({
            where: { email: user.email! }
          });

          if (!existingUser) {
            // Create new user for Google OAuth
            const newUser = await prisma.user.create({
              data: {
                email: user.email!,
                name: user.name || profile?.name,
                profilePicture: user.image || profile?.picture,
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

      // Return previous token if the access token has not expired yet
      if (Date.now() < (token.accessTokenExpires as number)) {
        return token;
      }

      // Access token has expired, log and throw error
      securityLogger.logAuthFailure(
        token.id as string,
        '/api/auth/jwt',
        'Token expired, re-authentication required'
      );
      throw new Error('RefreshAccessTokenError');
    },
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id as string;
        (session.user as User & { isAdmin: boolean }).isAdmin = token.isAdmin as boolean;
        // Add expiration info to session for client-side handling
        (session as ExtendedSession).expires = new Date(token.accessTokenExpires as number).toISOString();
      }
      return session;
    },
  },
};

export const { auth, signIn, signOut } = NextAuth(authConfig);