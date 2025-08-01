import { assert, describe, it } from "@effect/vitest"
import { Groups } from "app/Groups"
import { GroupsRepo } from "app/Groups/Repo"
import { Group, GroupId } from "app/Domain/Group"
import { AccountId } from "app/Domain/Account"
import { withSystemActor } from "app/Domain/Policy"
import { SqlTest } from "app/Sql"
import { makeTestLayer } from "app/lib/Layer"
import { DateTime, Effect, Layer, Option, pipe } from "effect"

describe("Groups", () => {
  it.effect("createGroup", () =>
    Effect.gen(function*() {
      const groups = yield* Groups
      const group = yield* pipe(
        groups.create(AccountId.make(1), { name: "Test Group" }),
        withSystemActor
      )
      assert.strictEqual(group.id, 123)
      assert.strictEqual(group.ownerId, 1)
      assert.strictEqual(group.name, "Test Group")
    }).pipe(
      Effect.provide(
        Groups.DefaultWithoutDependencies.pipe(
          Layer.provideMerge(SqlTest),
          Layer.provideMerge(
            makeTestLayer(GroupsRepo)({
              insert: (group: typeof Group.insert.Type) =>
                Effect.map(
                  DateTime.now,
                  (now) =>
                    new Group({
                      ...group,
                      id: GroupId.make(123),
                      createdAt: now,
                      updatedAt: now
                    })
                )
            })
          )
        )
      )
    ))

  it.effect("findGroupById", () =>
    Effect.gen(function*() {
      const groups = yield* Groups
      const groupId = GroupId.make(123)
      const group = yield* pipe(
        groups.findById(groupId),
        withSystemActor
      )
      if (Option.isSome(group)) {
        const groupValue = group.value
        assert.strictEqual(groupValue.id, 123)
        assert.strictEqual(groupValue.name, "Test Group")
        assert.strictEqual(groupValue.ownerId, 1)
      }
      assert.strictEqual(Option.isSome(group), true)
    }).pipe(
      Effect.provide(
        Groups.DefaultWithoutDependencies.pipe(
          Layer.provideMerge(SqlTest),
          Layer.provideMerge(
            makeTestLayer(GroupsRepo)({
              findById: (id: GroupId) =>
                Effect.succeed(
                  Option.some(
                    new Group({
                      id,
                      name: "Test Group",
                      ownerId: AccountId.make(1),
                      createdAt: Effect.runSync(DateTime.now),
                      updatedAt: Effect.runSync(DateTime.now)
                    })
                  )
                )
            })
          )
        )
      )
    ))
})