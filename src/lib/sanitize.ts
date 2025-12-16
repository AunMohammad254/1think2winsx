/**
 * Sanitize HTML content to prevent XSS attacks
 * This utility provides safe HTML sanitization for user-generated content
 */
export class HTMLSanitizer {
  private static instance: HTMLSanitizer;
  private isServer: boolean;

  private constructor() {
    this.isServer = typeof window === 'undefined';
  }

  public static getInstance(): HTMLSanitizer {
    if (!HTMLSanitizer.instance) {
      HTMLSanitizer.instance = new HTMLSanitizer();
    }
    return HTMLSanitizer.instance;
  }

  /**
   * Sanitize HTML content for safe rendering
   * @param dirty - The potentially unsafe HTML string
   * @returns Sanitized HTML string
   */
  public sanitize(dirty: string): string {
    if (typeof dirty !== 'string') {
      return '';
    }

    // Use regex-based sanitization since DOMPurify package was removed
    return this.serverSideSanitize(dirty);
  }

  /**
   * Server-side sanitization using regex patterns
   * @param dirty - The potentially unsafe HTML string
   * @returns Sanitized HTML string
   */
  private serverSideSanitize(dirty: string): string {
    // Remove script tags and their content
    let clean = dirty.replace(/<script[^>]*>.*?<\/script>/gis, '');

    // Remove dangerous attributes
    clean = clean.replace(/\s*on\w+\s*=\s*["'][^"']*["']/gi, '');
    clean = clean.replace(/\s*javascript\s*:/gi, '');
    clean = clean.replace(/\s*data\s*:/gi, '');

    // Allow only safe tags
    const allowedTags = ['b', 'i', 'em', 'strong', 'u', 'br', 'p'];
    const tagPattern = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;

    clean = clean.replace(tagPattern, (match, tagName) => {
      if (allowedTags.includes(tagName.toLowerCase())) {
        // For allowed tags, remove all attributes for safety
        return match.replace(/\s+[a-zA-Z-]+\s*=\s*["'][^"']*["']/g, '');
      }
      return ''; // Remove disallowed tags
    });

    return clean;
  }

  /**
   * Sanitize plain text content (removes all HTML)
   * @param dirty - The potentially unsafe string
   * @returns Plain text string
   */
  public sanitizeText(dirty: string): string {
    if (typeof dirty !== 'string') {
      return '';
    }

    // Remove all HTML tags and decode entities
    const withoutTags = dirty.replace(/<[^>]*>/g, '');

    // Basic entity decoding for common cases
    return withoutTags
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'");
  }

  /**
   * Validate and sanitize quiz content
   * @param content - Quiz question or option text
   * @returns Sanitized content safe for rendering
   */
  public sanitizeQuizContent(content: string): string {
    if (typeof content !== 'string') {
      return '';
    }

    // For quiz content, we want to be extra strict - no HTML allowed
    return this.sanitizeText(content).trim();
  }
}

// Export singleton instance
export const htmlSanitizer = HTMLSanitizer.getInstance();

// Convenience functions
export const sanitizeHTML = (dirty: string): string => htmlSanitizer.sanitize(dirty);
export const sanitizeText = (dirty: string): string => htmlSanitizer.sanitizeText(dirty);
export const sanitizeQuizContent = (dirty: string): string => htmlSanitizer.sanitizeQuizContent(dirty);