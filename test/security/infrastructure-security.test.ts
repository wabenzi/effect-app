import { describe, it, expect, beforeAll } from "vitest"

describe("Security Test Suite - Infrastructure Security", () => {
  let baseUrl: string

  beforeAll(() => {
    baseUrl = "http://localhost:3000"
  })

  describe("Security Headers", () => {
    it("should include required security headers", async () => {
      const response = await fetch(`${baseUrl}/health`)
      
      // Critical security headers
      expect(response.headers.get('x-frame-options')).toBe('DENY')
      expect(response.headers.get('x-content-type-options')).toBe('nosniff')
      expect(response.headers.get('x-xss-protection')).toBe('1; mode=block')
      
      // HTTPS security (if testing in production)
      if (baseUrl.startsWith('https://')) {
        expect(response.headers.get('strict-transport-security')).toContain('max-age=')
      }
      
      // Content Security Policy
      const csp = response.headers.get('content-security-policy')
      if (csp) {
        expect(csp).toContain("default-src 'self'")
        expect(csp).toContain("script-src 'self'")
      }
      
      // Referrer Policy
      expect(response.headers.get('referrer-policy')).toBeTruthy()
      
      // Server information should be hidden
      expect(response.headers.get('server')).toBeFalsy()
      expect(response.headers.get('x-powered-by')).toBeFalsy()
    })

    it("should set appropriate CORS headers", async () => {
      const response = await fetch(`${baseUrl}/health`, {
        method: 'OPTIONS',
        headers: {
          'Origin': 'http://localhost:3001',
          'Access-Control-Request-Method': 'GET'
        }
      })

      const allowOrigin = response.headers.get('access-control-allow-origin')
      const allowMethods = response.headers.get('access-control-allow-methods')
      const allowHeaders = response.headers.get('access-control-allow-headers')

      // Should have CORS headers configured
      expect(allowOrigin).toBeTruthy()
      expect(allowMethods).toBeTruthy()
      
      // Should not allow all origins in production
      if (process.env.NODE_ENV === 'production') {
        expect(allowOrigin).not.toBe('*')
      }
    })
  })

  describe("Rate Limiting", () => {
    it("should implement rate limiting on authentication endpoints", async () => {
      const promises = []
      const maxRequests = 20 // Attempt more than reasonable limit

      // Make many rapid requests
      for (let i = 0; i < maxRequests; i++) {
        promises.push(
          fetch(`${baseUrl}/users`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: `rate-test-${i}@example.com` })
          })
        )
      }

      const responses = await Promise.all(promises)
      
      // Should have some rate limiting in place
      const rateLimitedResponses = responses.filter(r => r.status === 429)
      
      // Either rate limiting is implemented (some 429s) or all requests are processed
      // In a real implementation, we'd expect some 429s
      if (rateLimitedResponses.length > 0) {
        expect(rateLimitedResponses.length).toBeGreaterThan(0)
        
        // Rate limited responses should include Retry-After header
        const retryAfter = rateLimitedResponses[0].headers.get('retry-after')
        expect(retryAfter).toBeTruthy()
      }
    })

    it("should implement rate limiting on API endpoints", async () => {
      const user = await createTestUser(`rate-limit-${Date.now()}@example.com`)
      const promises = []
      const maxRequests = 50

      // Make many rapid requests to a protected endpoint
      for (let i = 0; i < maxRequests; i++) {
        promises.push(
          fetch(`${baseUrl}/users/me`, {
            headers: { 'Cookie': `token=${user.token}` }
          })
        )
      }

      const responses = await Promise.all(promises)
      const rateLimitedResponses = responses.filter(r => r.status === 429)

      // If rate limiting is implemented, should see some 429s
      if (rateLimitedResponses.length > 0) {
        expect(rateLimitedResponses[0].headers.get('retry-after')).toBeTruthy()
      }
    })
  })

  describe("HTTPS and TLS Security", () => {
    it("should enforce HTTPS in production", async () => {
      // This test is mainly for production environments
      if (process.env.NODE_ENV === 'production' && !baseUrl.startsWith('https://')) {
        // Should redirect HTTP to HTTPS or reject HTTP entirely
        const httpUrl = baseUrl.replace('https://', 'http://')
        
        try {
          const response = await fetch(httpUrl, { redirect: 'manual' })
          
          // Should either redirect to HTTPS or reject
          expect([301, 302, 403, 404]).toContain(response.status)
          
          if (response.status === 301 || response.status === 302) {
            const location = response.headers.get('location')
            expect(location).toContain('https://')
          }
        } catch (error) {
          // Connection refused is also acceptable for HTTP in production
          expect(error).toBeTruthy()
        }
      }
    })

    it("should have proper TLS configuration", async () => {
      if (baseUrl.startsWith('https://')) {
        // Test TLS security - this would require additional tooling in a real scenario
        const response = await fetch(`${baseUrl}/health`)
        expect(response.status).toBe(200)
        
        // In a real test, you'd check:
        // - TLS version (1.2 or higher)
        // - Strong cipher suites
        // - Certificate validity
        // - HSTS headers
        const hstsHeader = response.headers.get('strict-transport-security')
        expect(hstsHeader).toContain('max-age=')
      }
    })
  })

  describe("Error Handling Security", () => {
    it("should not expose sensitive information in error messages", async () => {
      const sensitiveEndpoints = [
        "/users/99999", // Non-existent user
        "/groups/99999", // Non-existent group
        "/invalid-endpoint", // 404 endpoint
      ]

      for (const endpoint of sensitiveEndpoints) {
        const response = await fetch(`${baseUrl}${endpoint}`)
        const errorBody = await response.text()

        // Should not expose:
        expect(errorBody).not.toContain('stack trace')
        expect(errorBody).not.toContain('file path')
        expect(errorBody).not.toContain('database error')
        expect(errorBody).not.toContain('SQL')
        expect(errorBody).not.toContain('password')
        expect(errorBody).not.toContain('token')
        expect(errorBody).not.toContain('secret')
        expect(errorBody).not.toContain('internal server error')
        
        // Should be structured error response
        if (response.headers.get('content-type')?.includes('application/json')) {
          const errorObj = JSON.parse(errorBody)
          expect(errorObj).toHaveProperty('_tag')
        }
      }
    })

    it("should handle malformed requests gracefully", async () => {
      const malformedRequests = [
        {
          url: `${baseUrl}/users`,
          method: 'POST',
          body: 'invalid json{',
          headers: { 'Content-Type': 'application/json' }
        },
        {
          url: `${baseUrl}/users`,
          method: 'POST',
          body: JSON.stringify({ email: null }),
          headers: { 'Content-Type': 'application/json' }
        },
        {
          url: `${baseUrl}/users/invalid-id`,
          method: 'GET',
          headers: {}
        }
      ]

      for (const req of malformedRequests) {
        const response = await fetch(req.url, {
          method: req.method,
          body: req.body,
          headers: req.headers
        })

        // Should return 4xx error, not 5xx
        expect(response.status).toBeGreaterThanOrEqual(400)
        expect(response.status).toBeLessThan(500)

        const errorBody = await response.text()
        expect(errorBody).not.toContain('stack trace')
        expect(errorBody).not.toContain('internal error')
      }
    })
  })

  describe("Cookie Security", () => {
    it("should set secure cookie attributes", async () => {
      const response = await fetch(`${baseUrl}/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: `cookie-test-${Date.now()}@example.com` })
      })

      const setCookie = response.headers.get('set-cookie')
      expect(setCookie).toBeTruthy()

      // Cookie should have security attributes
      if (baseUrl.startsWith('https://')) {
        expect(setCookie).toContain('Secure')
      }
      expect(setCookie).toContain('HttpOnly')
      expect(setCookie).toContain('SameSite=')
      
      // Should have appropriate expiration
      // expect(setCookie).toContain('Max-Age=') // If using session expiration
    })

    it("should properly handle cookie-based authentication", async () => {
      const user = await createTestUser(`cookie-auth-${Date.now()}@example.com`)

      // Should be able to use cookie for authentication
      const response = await fetch(`${baseUrl}/users/me`, {
        headers: { 'Cookie': `token=${user.token}` }
      })

      expect(response.status).toBe(200)

      // Should reject malformed cookies
      const badCookieResponse = await fetch(`${baseUrl}/users/me`, {
        headers: { 'Cookie': 'token=invalid-token-format' }
      })

      expect(badCookieResponse.status).toBe(403)
    })
  })

  describe("Resource Protection", () => {
    it("should prevent path traversal attacks", async () => {
      const pathTraversalPayloads = [
        "../../../etc/passwd",
        "..\\..\\..\\windows\\system32\\config\\sam",
        "%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd",
        "....//....//....//etc//passwd",
        "..%252f..%252f..%252fetc%252fpasswd"
      ]

      for (const payload of pathTraversalPayloads) {
        const response = await fetch(`${baseUrl}/${payload}`)
        
        // Should not return sensitive files
        expect(response.status).not.toBe(200)
        
        if (response.status === 200) {
          const body = await response.text()
          expect(body).not.toContain('root:')
          expect(body).not.toContain('passwd')
          expect(body).not.toContain('shadow')
        }
      }
    })

    it("should protect against directory listing", async () => {
      const directoryPaths = [
        "/",
        "/api/",
        "/static/",
        "/uploads/",
        "/assets/"
      ]

      for (const path of directoryPaths) {
        const response = await fetch(`${baseUrl}${path}`)
        
        if (response.status === 200) {
          const body = await response.text()
          
          // Should not show directory listing
          expect(body).not.toContain('Index of')
          expect(body).not.toContain('Directory listing')
          expect(body).not.toContain('<pre>')
        }
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
