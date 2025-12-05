import { NextResponse } from 'next/server';

/**
 * Security headers configuration for API responses
 */
export const SECURITY_HEADERS = {
  // Prevent MIME type sniffing
  'X-Content-Type-Options': 'nosniff',
  
  // Enable XSS protection
  'X-XSS-Protection': '1; mode=block',
  
  // Prevent clickjacking
  'X-Frame-Options': 'DENY',
  
  // Referrer policy for privacy
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  
  // Content Security Policy for API endpoints
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none';",
  
  // Permissions policy to disable unnecessary features
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  
  // Strict transport security (HTTPS only)
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  
  // Cross-origin policies
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  
  // Cache control for sensitive endpoints
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  'Pragma': 'no-cache',
  'Expires': '0'
} as const;

/**
 * Applies security headers to a NextResponse
 */
export function applySecurityHeaders(response: NextResponse): NextResponse {
  Object.entries(SECURITY_HEADERS).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  
  return response;
}

/**
 * Creates a new NextResponse with security headers applied
 */
export function createSecureResponse(
  body?: BodyInit | null,
  init?: ResponseInit
): NextResponse {
  const response = new NextResponse(body, init);
  return applySecurityHeaders(response);
}

/**
 * Creates a JSON response with security headers
 */
export function createSecureJsonResponse(
  data: unknown,
  init?: ResponseInit
): NextResponse {
  const response = NextResponse.json(data, init);
  return applySecurityHeaders(response);
}

/**
 * Security headers specifically for file upload endpoints
 */
export const FILE_UPLOAD_HEADERS = {
  ...SECURITY_HEADERS,
  // More restrictive CSP for file uploads
  'Content-Security-Policy': "default-src 'none'; img-src 'self'; frame-ancestors 'none';",
  // Additional file upload security
  'X-Permitted-Cross-Domain-Policies': 'none'
} as const;

/**
 * Creates a JSON response with file upload security headers
 */
export function createSecureFileUploadResponse(
  data: unknown,
  init?: ResponseInit
): NextResponse {
  const response = NextResponse.json(data, init);
  
  Object.entries(FILE_UPLOAD_HEADERS).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  
  return response;
}