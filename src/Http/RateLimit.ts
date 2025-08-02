import { HttpApiBuilder, HttpApiMiddleware } from "@effect/platform"
import { Effect, Layer, Ref, Schedule } from "effect"

// Rate limiting configuration
interface RateLimitConfig {
  readonly windowMs: number // Time window in milliseconds
  readonly maxRequests: number // Max requests per window
  readonly keyGenerator?: (request: any) => string // Custom key generator
}

// Rate limit store
interface RateLimitEntry {
  readonly count: number
  readonly resetTime: number
}

// In-memory rate limit store (consider Redis for production)
const rateLimitStore = new Map<string, RateLimitEntry>()

// Rate limiting middleware
export class RateLimit extends HttpApiMiddleware.Tag<RateLimit>()(
  "Security/RateLimit",
  {
    failure: Schema.TaggedError<{ _tag: "RateLimitExceeded"; retryAfter: number }>()("RateLimitExceeded", {
      retryAfter: Schema.Number
    }, HttpApiSchema.annotations({ status: 429 }))
  }
) {}

export const RateLimitLive = (config: RateLimitConfig) =>
  Layer.effect(
    RateLimit,
    Effect.gen(function*() {
      return RateLimit.of({
        middleware: (request) =>
          Effect.gen(function*() {
            const key = config.keyGenerator?.(request) ?? getClientIP(request)
            const now = Date.now()
            
            // Clean expired entries
            cleanExpiredEntries(now, config.windowMs)
            
            const entry = rateLimitStore.get(key)
            const resetTime = now + config.windowMs
            
            if (!entry || now >= entry.resetTime) {
              // First request or window expired
              rateLimitStore.set(key, { count: 1, resetTime })
              return Effect.succeed(undefined)
            }
            
            if (entry.count >= config.maxRequests) {
              // Rate limit exceeded
              const retryAfter = Math.ceil((entry.resetTime - now) / 1000)
              return Effect.fail(new RateLimitExceeded({ retryAfter }))
            }
            
            // Increment counter
            rateLimitStore.set(key, { ...entry, count: entry.count + 1 })
            return Effect.succeed(undefined)
          })
      })
    })
  )

// Helper functions
const getClientIP = (request: any): string => {
  return request.headers?.['x-forwarded-for']?.split(',')[0] || 
         request.headers?.['x-real-ip'] || 
         request.connection?.remoteAddress || 
         '127.0.0.1'
}

const cleanExpiredEntries = (now: number, windowMs: number): void => {
  for (const [key, entry] of rateLimitStore.entries()) {
    if (now >= entry.resetTime) {
      rateLimitStore.delete(key)
    }
  }
}

// Predefined configurations
export const StrictRateLimit = RateLimitLive({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 100 // 100 requests per 15 minutes
})

export const AuthRateLimit = RateLimitLive({
  windowMs: 15 * 60 * 1000, // 15 minutes  
  maxRequests: 5 // 5 login attempts per 15 minutes
})
