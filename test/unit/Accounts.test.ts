import { assert, describe, it } from "@effect/vitest"
import { Accounts } from "app/Accounts"
import { AccountsRepo } from "app/Accounts/AccountsRepo"
import { UsersRepo } from "app/Accounts/UsersRepo"
import { Account, AccountId } from "app/Domain/Account"
import { Email } from "app/Domain/Email"
import { withSystemActor } from "app/Domain/Policy"
import { User, UserId } from "app/Domain/User"
import { makeTestLayer } from "app/lib/Layer"
import { DateTime, Effect, Layer, Option, pipe, Redacted } from "effect"
import { accessTokenFromRedacted } from "../../src/Domain/AccessToken.js"

describe("Accounts", () => {
  it.effect("createUser", () =>
    Effect.gen(function*() {
      const accounts = yield* Accounts
      const user = yield* pipe(
        accounts.createUser({ email: Email.make("test@example.com") }),
        withSystemActor
      )
      assert.strictEqual(user.id, 1)
      assert.strictEqual(user.accountId, 123)
      assert.strictEqual(user.account.id, 123)
      assert.strictEqual(Redacted.value(user.accessToken), "test-uuid")
    }).pipe(
      Effect.provide(
        Accounts.Test.pipe(
          Layer.provide(
            makeTestLayer(AccountsRepo)({
              insert: (account) =>
                Effect.map(
                  DateTime.now,
                  (now) =>
                    new Account({
                      ...account,
                      id: AccountId.make(123),
                      createdAt: now,
                      updatedAt: now
                    })
                )
            })
          ),
          Layer.provide(
            makeTestLayer(UsersRepo)({
              insert: (user) =>
                Effect.map(
                  DateTime.now,
                  (now) =>
                    new User({
                      ...user,
                      id: UserId.make(1),
                      createdAt: now,
                      updatedAt: now
                    })
                )
            })
          )
        )
      )
    ))

  it.effect("findUserByAccessToken", () =>
    Effect.gen(function*() {
      const accounts = yield* Accounts
      const apiKey = accessTokenFromRedacted(
        Redacted.make("test-uuid")
      )
      const user = yield* pipe(
        accounts.findUserByAccessToken(apiKey),
        withSystemActor
      )
      if (Option.isSome(user)) {
        const userValue = user.value
        assert.strictEqual(userValue.id, 1)
        assert.strictEqual(userValue.accountId, 123)
        assert.strictEqual(userValue.email, Email.make("test@example.com"))
      }
      assert.strictEqual(Option.isSome(user), true)
    }).pipe(
      Effect.provide(
        Accounts.Test.pipe(
          Layer.provide(
            makeTestLayer(AccountsRepo)({
              insert: (account) =>
                Effect.map(
                  DateTime.now,
                  (now) =>
                    new Account({
                      ...account,
                      id: AccountId.make(123),
                      createdAt: now,
                      updatedAt: now
                    })
                )
            })
          ),
          Layer.provide(
            makeTestLayer(UsersRepo)({
              findByAccessToken: (apiKey) =>
                Effect.succeed(
                  Option.some(
                    new User({
                      id: UserId.make(1),
                      email: Email.make("test@example.com"),
                      accountId: AccountId.make(123),
                      createdAt: Effect.runSync(DateTime.now),
                      updatedAt: Effect.runSync(DateTime.now),
                      accessToken: apiKey
                    })
                  )
                )
            })
          )
        )
      )
    ))

  it.effect("findUserById", () =>
    Effect.gen(function*() {
      const accounts = yield* Accounts
      const userId = UserId.make(1)
      const user = yield* pipe(
        accounts.findUserById(userId),
        withSystemActor
      )
      if (Option.isSome(user)) {
        const userValue = user.value
        assert.strictEqual(userValue.id, 1)
        assert.strictEqual(userValue.accountId, 123)
        assert.strictEqual(userValue.email, Email.make("test@example.com"))
      }
      assert.strictEqual(Option.isSome(user), true)
    }).pipe(
      Effect.provide(
        Accounts.Test.pipe(
          Layer.provide(
            makeTestLayer(AccountsRepo)({
              insert: (account) =>
                Effect.map(
                  DateTime.now,
                  (now) =>
                    new Account({
                      ...account,
                      id: AccountId.make(123),
                      createdAt: now,
                      updatedAt: now
                    })
                )
            })
          ),
          Layer.provide(
            makeTestLayer(UsersRepo)({
              findById: (id: UserId) =>
                Effect.succeed(
                  Option.some(
                    new User({
                      id,
                      email: Email.make("test@example.com"),
                      accountId: AccountId.make(123),
                      createdAt: Effect.runSync(DateTime.now),
                      updatedAt: Effect.runSync(DateTime.now),
                      accessToken: accessTokenFromRedacted(Redacted.make("test-uuid"))
                    })
                  )
                )
            })
          )
        )
      )
    ))
})
