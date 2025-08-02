import { describe, it, expect, beforeAll, afterAll } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { NodeHttpClient } from "@effect/platform-node"
import { HttpClient, HttpClientRequest } from "@effect/platform"
import { Api } from "../../src/Api.js"
import { SqlTest } from "../../src/Sql.js"

describe("Security Test Suite - Authentication & Authorization", () => {
  let baseUrl: string
  let serverProcess: any

  beforeAll(async () => {
    baseUrl = "http://localhost:3000"
    // Assume server is already running for tests
  })

  afterAll(async () => {
    // Cleanup if needed
  })

  describe("Token Security Tests", () => {
    it("should reject requests with malformed tokens", async () => {
      const malformedTokens = [
        "invalid-token",
        "Bearer invalid",
        "token=malformed",
        "",
        "null",
        "undefined",
        "12345",
        "../../../../etc/passwd"
      ]

      for (const token of malformedTokens) {
        const response = await fetch(`${baseUrl}/users/me`, {
          headers: {
            'Cookie': `token=${token}`
          }
        })

        expect(response.status).toBe(403)
        const body = await response.json()
        expect(body._tag).toBe("Unauthorized")
      }
    })

    it("should reject requests without authentication tokens", async () => {
      const protectedEndpoints = [
        "/users/me",
        "/users/1",
        "/groups",
        "/groups/1/people"
      ]

      for (const endpoint of protectedEndpoints) {
        const response = await fetch(`${baseUrl}${endpoint}`)
        expect(response.status).toBe(403)
        
        const body = await response.json()
        expect(body._tag).toBe("Unauthorized")
      }
    })

    it("should prevent token fixation attacks", async () => {
      // Create user with one session
      const email1 = `security-test-1-${Date.now()}@example.com`
      const createResponse1 = await fetch(`${baseUrl}/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email1 })
      })

      expect(createResponse1.status).toBe(200)
      const setCookie1 = createResponse1.headers.get('set-cookie')
      const token1 = setCookie1?.match(/token=([^;]+)/)?.[1]

      // Create another user with different session
      const email2 = `security-test-2-${Date.now()}@example.com`
      const createResponse2 = await fetch(`${baseUrl}/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email2 })
      })

      expect(createResponse2.status).toBe(200)
      const setCookie2 = createResponse2.headers.get('set-cookie')
      const token2 = setCookie2?.match(/token=([^;]+)/)?.[1]

      // Tokens should be different
      expect(token1).toBeTruthy()
      expect(token2).toBeTruthy()
      expect(token1).not.toBe(token2)

      // User 1's token should not work for user 2's data
      const user1Data = await fetch(`${baseUrl}/users/me`, {
        headers: { 'Cookie': `token=${token1}` }
      })
      const user1Json = await user1Data.json()

      const user2Data = await fetch(`${baseUrl}/users/me`, {
        headers: { 'Cookie': `token=${token2}` }
      })
      const user2Json = await user2Data.json()

      expect(user1Json.id).not.toBe(user2Json.id)
      expect(user1Json.email).toBe(email1)
      expect(user2Json.email).toBe(email2)
    })

    it("should generate cryptographically secure tokens", async () => {
      const tokens = new Set<string>()
      const iterations = 100

      for (let i = 0; i < iterations; i++) {
        const email = `token-test-${i}-${Date.now()}@example.com`
        const response = await fetch(`${baseUrl}/users`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        })

        const setCookie = response.headers.get('set-cookie')
        const token = setCookie?.match(/token=([^;]+)/)?.[1]
        
        expect(token).toBeTruthy()
        expect(token!.length).toBeGreaterThanOrEqual(32) // Minimum length check
        expect(tokens.has(token!)).toBe(false) // No duplicates
        
        tokens.add(token!)
      }

      // Should have generated unique tokens
      expect(tokens.size).toBe(iterations)
    })
  })

  describe("Authorization Tests", () => {
    it("should prevent cross-user data access", async () => {
      // Create two users
      const user1Email = `cross-test-1-${Date.now()}@example.com`
      const user2Email = `cross-test-2-${Date.now()}@example.com`

      const user1Response = await fetch(`${baseUrl}/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user1Email })
      })

      const user2Response = await fetch(`${baseUrl}/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user2Email })
      })

      const user1Data = await user1Response.json()
      const user2Data = await user2Response.json()

      const token1 = user1Response.headers.get('set-cookie')?.match(/token=([^;]+)/)?.[1]
      const token2 = user2Response.headers.get('set-cookie')?.match(/token=([^;]+)/)?.[1]

      // User 1 should not be able to access User 2's data
      const unauthorizedResponse = await fetch(`${baseUrl}/users/${user2Data.id}`, {
        headers: { 'Cookie': `token=${token1}` }
      })

      expect(unauthorizedResponse.status).toBe(403)
      const errorBody = await unauthorizedResponse.json()
      expect(errorBody._tag).toBe("Unauthorized")
    })

    it("should enforce group ownership policies", async () => {
      // Create two users
      const owner = await createTestUser(`owner-${Date.now()}@example.com`)
      const nonOwner = await createTestUser(`nonowner-${Date.now()}@example.com`)

      // Owner creates a group
      const groupResponse = await fetch(`${baseUrl}/groups`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': `token=${owner.token}`
        },
        body: JSON.stringify({ name: `Test Group ${Date.now()}` })
      })

      expect(groupResponse.status).toBe(200)
      const group = await groupResponse.json()

      // Non-owner should not be able to modify the group
      const updateResponse = await fetch(`${baseUrl}/groups/${group.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': `token=${nonOwner.token}`
        },
        body: JSON.stringify({ name: "Hacked Group" })
      })

      expect(updateResponse.status).toBe(403)
    })
  })

  describe("Session Management", () => {
    it("should handle concurrent sessions securely", async () => {
      const email = `concurrent-${Date.now()}@example.com`
      
      // Create multiple sessions for the same user
      const sessions = await Promise.all([
        createTestUser(email),
        createTestUser(email),
        createTestUser(email)
      ])

      // All sessions should be valid but independent
      for (const session of sessions) {
        const response = await fetch(`${baseUrl}/users/me`, {
          headers: { 'Cookie': `token=${session.token}` }
        })
        expect(response.status).toBe(200)
        
        const userData = await response.json()
        expect(userData.email).toBe(email)
      }
    })
  })

  // Helper function
  async function createTestUser(email: string) {
    const response = await fetch(`${baseUrl}/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    })

    const userData = await response.json()
    const token = response.headers.get('set-cookie')?.match(/token=([^;]+)/)?.[1]

    return { userData, token: token! }
  }
})
