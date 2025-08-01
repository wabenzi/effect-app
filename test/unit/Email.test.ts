import { assert, describe, it } from "@effect/vitest"
import { Email } from "app/Domain/Email"
import { Schema } from "effect"

describe("Email Domain Entity", () => {
  it("creates valid email addresses", () => {
    const validEmails = [
      "test@example.com",
      "user.name@domain.co.uk",
      "firstname+lastname@company.org",
      "user123@test-domain.com"
    ]

    validEmails.forEach(email => {
      const result = Schema.decodeUnknownEither(Email)(email)
      assert.strictEqual(result._tag, "Right")
      if (result._tag === "Right") {
        assert.strictEqual(result.right, email)
      }
    })
  })

  it("rejects invalid email addresses", () => {
    const invalidEmails = [
      "not-an-email",
      "@domain.com",
      "user@",
      "user name@domain.com", // space not allowed
      "user@domain", // missing TLD
      "", // empty string
      "user@domain.", // domain can't end with dot
      "user@@domain.com", // double @
    ]

    invalidEmails.forEach(email => {
      const result = Schema.decodeUnknownEither(Email)(email)
      assert.strictEqual(result._tag, "Left", `Expected ${email} to be invalid but it was accepted`)
    })
  })

  it("preserves email case", () => {
    const email = "Test.User@EXAMPLE.COM"
    const result = Schema.decodeUnknownEither(Email)(email)
    assert.strictEqual(result._tag, "Right")
    if (result._tag === "Right") {
      assert.strictEqual(result.right, email)
    }
  })

  it("handles edge cases", () => {
    // Single character local part
    const singleChar = "a@domain.com"
    const result1 = Schema.decodeUnknownEither(Email)(singleChar)
    assert.strictEqual(result1._tag, "Right")

    // Maximum length email (typically limited by implementation)
    const longEmail = "a".repeat(64) + "@" + "b".repeat(60) + ".com"
    const result2 = Schema.decodeUnknownEither(Email)(longEmail)
    assert.strictEqual(result2._tag, "Right")
  })
})
