import { assert, describe, it } from "@effect/vitest"
import { People } from "app/People"
import { PeopleRepo } from "app/People/Repo"
import { Person, PersonId } from "app/Domain/Person"
import { GroupId } from "app/Domain/Group"
import { withSystemActor } from "app/Domain/Policy"
import { SqlTest } from "app/Sql"
import { makeTestLayer } from "app/lib/Layer"
import { DateTime, Effect, Layer, Option, pipe } from "effect"

describe("People", () => {
  it.effect("createPerson", () =>
    Effect.gen(function*() {
      const people = yield* People
      const person = yield* pipe(
        people.create(GroupId.make(1), { 
          firstName: "John", 
          lastName: "Doe",
          dateOfBirth: Option.none()
        }),
        withSystemActor
      )
      assert.strictEqual(person.id, 456)
      assert.strictEqual(person.groupId, 1)
      assert.strictEqual(person.firstName, "John")
      assert.strictEqual(person.lastName, "Doe")
    }).pipe(
      Effect.provide(
        People.DefaultWithoutDependencies.pipe(
          Layer.provideMerge(SqlTest),
          Layer.provideMerge(
            makeTestLayer(PeopleRepo)({
              insert: (person: typeof Person.insert.Type) =>
                Effect.map(
                  DateTime.now,
                  (now) =>
                    new Person({
                      ...person,
                      id: PersonId.make(456),
                      createdAt: now,
                      updatedAt: now
                    })
                )
            })
          )
        )
      )
    ))

  it.effect("findPersonById", () =>
    Effect.gen(function*() {
      const people = yield* People
      const personId = PersonId.make(456)
      const person = yield* pipe(
        people.findById(personId),
        withSystemActor
      )
      if (Option.isSome(person)) {
        const personValue = person.value
        assert.strictEqual(personValue.id, 456)
        assert.strictEqual(personValue.firstName, "John")
        assert.strictEqual(personValue.lastName, "Doe")
        assert.strictEqual(personValue.groupId, 1)
      }
      assert.strictEqual(Option.isSome(person), true)
    }).pipe(
      Effect.provide(
        People.DefaultWithoutDependencies.pipe(
          Layer.provideMerge(SqlTest),
          Layer.provideMerge(
            makeTestLayer(PeopleRepo)({
              findById: (id: PersonId) =>
                Effect.succeed(
                  Option.some(
                    new Person({
                      id,
                      firstName: "John",
                      lastName: "Doe",
                      dateOfBirth: Option.none(),
                      groupId: GroupId.make(1),
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