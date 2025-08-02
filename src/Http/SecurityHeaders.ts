import { HttpApiMiddleware } from "@effect/platform"
import { Effect, Layer } from "effect"

// Security headers middleware
export class SecurityHeaders extends HttpApiMiddleware.Tag<SecurityHeaders>()(
  "Security/Headers"
) {}

export const SecurityHeadersLive = Layer.effect(
  SecurityHeaders,
  Effect.gen(function*() {
    return SecurityHeaders.of({
      middleware: (request, response) =>
        Effect.gen(function*() {
          // Security headers to prevent common attacks
          const securityHeaders = {
            // Prevent clickjacking
            'X-Frame-Options': 'DENY',
            
            // Prevent MIME type sniffing
            'X-Content-Type-Options': 'nosniff',
            
            // Enable XSS protection
            'X-XSS-Protection': '1; mode=block',
            
            // Strict transport security (HTTPS only)
            'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
            
            // Content Security Policy
            'Content-Security-Policy': [
              "default-src 'self'",
              "script-src 'self'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data:",
              "font-src 'self'",
              "connect-src 'self'",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'"
            ].join('; '),
            
            // Referrer policy
            'Referrer-Policy': 'strict-origin-when-cross-origin',
            
            // Permissions policy
            'Permissions-Policy': [
              'camera=()',
              'microphone=()',
              'geolocation=()',
              'payment=()',
              'usb=()'
            ].join(', '),
            
            // Remove server information
            'Server': '',
            'X-Powered-By': ''
          }
          
          // Apply headers to response
          Object.entries(securityHeaders).forEach(([key, value]) => {
            response.setHeader(key, value)
          })
          
          return Effect.succeed(undefined)
        })
    })
  })
)

// CORS security configuration
export const SecureCORS = {
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://yourdomain.com'] // Restrict in production
    : ['http://localhost:3000', 'http://localhost:3001'], // Allow local dev
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cookie'],
  maxAge: 86400 // 24 hours
}
