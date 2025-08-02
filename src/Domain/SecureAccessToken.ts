import { randomBytes, createHash } from 'crypto'
import { Redacted, Schema } from "effect"

export const SecureAccessTokenString = Schema.String.pipe(Schema.brand("SecureAccessToken"))
export const SecureAccessToken = Schema.Redacted(SecureAccessTokenString)
export type SecureAccessToken = typeof SecureAccessToken.Type

// Generate cryptographically secure token
export const generateSecureAccessToken = (): SecureAccessToken => {
  const token = randomBytes(32).toString('hex') // 256-bit token
  return Redacted.make(SecureAccessTokenString.make(token))
}

// Hash token for database storage (never store plain tokens)
export const hashToken = (token: string): string => {
  return createHash('sha256').update(token).digest('hex')
}

// Verify token against hash
export const verifyToken = (token: string, hash: string): boolean => {
  return hashToken(token) === hash
}

// Token with expiration
export interface TokenWithExpiry {
  readonly token: SecureAccessToken
  readonly expiresAt: Date
  readonly issuedAt: Date
}

export const createTokenWithExpiry = (expiryHours: number = 24): TokenWithExpiry => {
  const now = new Date()
  const expiresAt = new Date(now.getTime() + (expiryHours * 60 * 60 * 1000))
  
  return {
    token: generateSecureAccessToken(),
    expiresAt,
    issuedAt: now
  }
}

export const isTokenExpired = (tokenData: TokenWithExpiry): boolean => {
  return new Date() > tokenData.expiresAt
}
