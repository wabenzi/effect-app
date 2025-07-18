import { assert, describe, it } from "@effect/vitest"
import { Uuid } from "app/Uuid"
import { Effect } from "effect"
// UUID v7 format: 8-4-4-4-12 hex digits, version 7
const uuidV7Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i

describe("Uuid", () => {
  it.effect("generate default uuid in v7 format", () =>
    Effect.gen(function*() {
      const uuidService = yield* Uuid
      const id = yield* uuidService.generate
      assert.match(id, uuidV7Regex)
    }).pipe(
      Effect.provide(Uuid.Default)
    ))

  it.effect("generate test uuid from Test layer", () =>
    Effect.gen(function*() {
      const uuidService = yield* Uuid
      const id = yield* uuidService.generate
      assert.strictEqual(id, "test-uuid")
    }).pipe(
      Effect.provide(Uuid.Test)
    ))
})
