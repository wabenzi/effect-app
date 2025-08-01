import { assert, describe, it } from "@effect/vitest"
import { AccountId } from "app/Domain/Account"
import { UserId } from "app/Domain/User"

describe("Account Domain Entities", () => {
  it("creates account ID", () => {
    const id = AccountId.make(123)
    assert.strictEqual(id, 123)
  })

  it("creates user ID", () => {
    const id = UserId.make(456)
    assert.strictEqual(id, 456)
  })

  it("handles ID comparisons", () => {
    const accountId1 = AccountId.make(123)
    const accountId2 = AccountId.make(123)
    const userId1 = UserId.make(456)
    const userId2 = UserId.make(456)
    
    assert.strictEqual(accountId1, accountId2)
    assert.strictEqual(userId1, userId2)
    // Different types should have different values
    assert.strictEqual(typeof accountId1, "number")
    assert.strictEqual(typeof userId1, "number")
  })
})
