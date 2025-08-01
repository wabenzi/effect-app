import { assert, describe, it } from "@effect/vitest"
import { GroupId } from "app/Domain/Group"

describe("Groups Domain Entity", () => {
  it("creates group ID", () => {
    const id = GroupId.make(123)
    assert.strictEqual(id, 123)
  })

  it("handles group ID comparison", () => {
    const id1 = GroupId.make(123)
    const id2 = GroupId.make(123)
    assert.strictEqual(id1, id2)
  })
})
