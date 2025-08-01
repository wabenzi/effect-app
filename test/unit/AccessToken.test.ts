import { assert, describe, it } from "@effect/vitest"
import { AccessToken, accessTokenFromString, accessTokenFromRedacted } from "app/Domain/AccessToken"
import { Redacted } from "effect"

describe("AccessToken Domain Entity", () => {
  it("creates access token from string", () => {
    const tokenString = "abc123-def456-token"
    const token = accessTokenFromString(tokenString)
    
    // Token should be redacted
    assert.strictEqual(Redacted.isRedacted(token), true)
    
    // Value should match original string
    const value = Redacted.value(token)
    assert.strictEqual(value, tokenString)
  })

  it("creates access token from redacted", () => {
    const tokenString = "secret-token-value"
    const redacted = Redacted.make(tokenString)
    const token = accessTokenFromRedacted(redacted)
    
    // Token should be redacted
    assert.strictEqual(Redacted.isRedacted(token), true)
    
    // Value should match original string
    const value = Redacted.value(token)
    assert.strictEqual(value, tokenString)
  })

  it("preserves token security through redaction", () => {
    const secretToken = "super-secret-token-123"
    const token = accessTokenFromString(secretToken)
    
    // Direct string conversion should show redacted value
    const stringified = JSON.stringify(token)
    assert.strictEqual(stringified.includes(secretToken), false)
    assert.strictEqual(stringified.includes("redacted"), true)
  })

  it("handles empty and special character tokens", () => {
    const specialTokens = [
      "",
      "token-with-dashes",
      "token_with_underscores",
      "token.with.dots",
      "token+with+plus",
      "token=with=equals"
    ]

    specialTokens.forEach(tokenString => {
      const token = accessTokenFromString(tokenString)
      assert.strictEqual(Redacted.isRedacted(token), true)
      assert.strictEqual(Redacted.value(token), tokenString)
    })
  })

  it("maintains type safety", () => {
    const tokenString = "type-safe-token"
    const token = accessTokenFromString(tokenString)
    
    // Token should be of AccessToken type
    const isAccessToken = (t: any): t is AccessToken => Redacted.isRedacted(t)
    assert.strictEqual(isAccessToken(token), true)
  })
})
