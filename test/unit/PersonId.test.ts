import { assert, describe, it } from "@effect/vitest"
import { PersonId } from "app/Domain/Person"

describe("Person Domain Entity", () => {
  it("creates person ID", () => {
    const id = PersonId.make(123)
    assert.strictEqual(id, 123)
  })

  it("handles person ID comparison", () => {
    const id1 = PersonId.make(123)
    const id2 = PersonId.make(123)
    assert.strictEqual(id1, id2)
  })

  it("creates different person IDs", () => {
    const id1 = PersonId.make(123)
    const id2 = PersonId.make(456)
    assert.notStrictEqual(id1, id2)
  })
})
