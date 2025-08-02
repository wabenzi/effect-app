import { Schema, Effect } from "effect"
import DOMPurify from 'isomorphic-dompurify'

// Simple validation middleware function
export const validationMiddleware = (app: any) =>
  Effect.gen(function*() {
    // Basic validation logic would go here
    // For now, just pass through the app
    return app
  })

// Input sanitization utilities
export const sanitizeString = (input: string): string => {
  // Remove potential XSS vectors
  return DOMPurify.sanitize(input, { 
    ALLOWED_TAGS: [], // No HTML tags allowed
    ALLOWED_ATTR: []
  }).trim()
}

// Enhanced email validation
export const SecureEmail = Schema.String.pipe(
  Schema.pattern(/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/),
  Schema.maxLength(254), // RFC 5321 limit
  Schema.transform(
    Schema.String,
    {
      strict: true,
      decode: (email) => {
        // Normalize and sanitize email
        const normalized = email.toLowerCase().trim()
        const sanitized = sanitizeString(normalized)
        
        // Additional security checks
        if (sanitized !== normalized) {
          throw new Error("Email contains invalid characters")
        }
        
        return sanitized
      },
      encode: (email) => email
    }
  ),
  Schema.brand("SecureEmail")
)

// Secure name validation (prevents injection attacks)
export const SecureName = Schema.String.pipe(
  Schema.pattern(/^[a-zA-Z\s'-]{1,50}$/), // Only letters, spaces, hyphens, apostrophes
  Schema.transform(
    Schema.String,
    {
      strict: true,
      decode: (name) => {
        const sanitized = sanitizeString(name.trim())
        if (sanitized !== name.trim()) {
          throw new Error("Name contains invalid characters")
        }
        return sanitized
      },
      encode: (name) => name
    }
  ),
  Schema.brand("SecureName")
)

// SQL injection prevention for dynamic queries
export const sanitizeForSQL = (input: string): string => {
  // Remove or escape dangerous SQL characters
  return input
    .replace(/'/g, "''") // Escape single quotes
    .replace(/;/g, "") // Remove semicolons
    .replace(/--/g, "") // Remove SQL comments
    .replace(/\/\*/g, "") // Remove SQL block comments start
    .replace(/\*\//g, "") // Remove SQL block comments end
}

// Validation middleware for API endpoints
export const ValidationMiddleware = {
  validateEmail: (email: string) => Schema.decodeUnknown(SecureEmail)(email),
  validateName: (name: string) => Schema.decodeUnknown(SecureName)(name),
  validateRequired: <T>(value: T | null | undefined, fieldName: string): T => {
    if (value === null || value === undefined || value === '') {
      throw new Error(`${fieldName} is required`)
    }
    return value
  }
}
