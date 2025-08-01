import { describe, it, beforeAll, afterAll } from "@effect/vitest"
import { Effect, Ref, pipe, Layer, Fiber, Duration, Option } from "effect"
import { Cookies, HttpApiClient, HttpClient } from "@effect/platform"
import { NodeHttpClient } from "@effect/platform-node"
import { Api } from "app/Api"
import { HttpLive } from "app/Http"
import { TracingLive } from "app/Tracing"
import { Email } from "app/Domain/Email"
import { UserId } from "app/Domain/User"
import { GroupId } from "app/Domain/Group"
import { PersonId } from "app/Domain/Person"

describe("HTTP API Integration Tests", () => {
  let serverFiber: Fiber.RuntimeFiber<void, unknown>

  beforeAll(async () => {
    // Launch HTTP server with the same dependencies as main.ts
    const testServer = HttpLive.pipe(Layer.provide(TracingLive))
    
    serverFiber = await Effect.runPromise(
      Effect.fork(Layer.launch(testServer))
    )
    
    // Wait for server to be ready
    await Effect.runPromise(Effect.sleep(Duration.millis(3000)))
  }, 20000)

  afterAll(async () => {
    if (serverFiber) {
      await Effect.runPromise(Fiber.interrupt(serverFiber))
    }
  }, 10000)

  describe("User Account Management", () => {
    it.effect("creates a new user account", () =>
      Effect.gen(function*() {
        const cookies = yield* Ref.make(Cookies.empty)
        const client = yield* HttpApiClient.make(Api, {
          baseUrl: "http://localhost:3000",
          transformClient: HttpClient.withCookiesRef(cookies)
        })
        
        const email = Email.make("integration-test@example.com")
        const user = yield* client.accounts.createUser({
          payload: { email }
        })

        // Basic assertions using Effect's assert
        yield* Effect.sync(() => {
          if (user.email !== email) {
            throw new Error(`Expected email ${email}, got ${user.email}`)
          }
          if (typeof user.id !== "number") {
            throw new Error(`Expected number id, got ${typeof user.id}`)
          }
          if (!user.account) {
            throw new Error("Expected account to be defined")
          }
          if (typeof user.account.id !== "number") {
            throw new Error(`Expected number account.id, got ${typeof user.account.id}`)
          }
        })
      }).pipe(Effect.provide(NodeHttpClient.layerUndici)))

    it.effect("retrieves current user after creation", () =>
      Effect.gen(function*() {
        const cookies = yield* Ref.make(Cookies.empty)
        const client = yield* HttpApiClient.make(Api, {
          baseUrl: "http://localhost:3000",
          transformClient: HttpClient.withCookiesRef(cookies)
        })
        
        const email = Email.make("current-user-test@example.com")
        
        // Create user first
        const createdUser = yield* client.accounts.createUser({
          payload: { email }
        })

        // Get current user (should be automatically authenticated via cookie)
        const currentUser = yield* client.accounts.getUserMe()

        yield* Effect.sync(() => {
          if (currentUser.id !== createdUser.id) {
            throw new Error(`Expected id ${createdUser.id}, got ${currentUser.id}`)
          }
          if (currentUser.email !== email) {
            throw new Error(`Expected email ${email}, got ${currentUser.email}`)
          }
        })
      }).pipe(Effect.provide(NodeHttpClient.layerUndici)))

    it.effect("updates user information", () =>
      Effect.gen(function*() {
        const cookies = yield* Ref.make(Cookies.empty)
        const client = yield* HttpApiClient.make(Api, {
          baseUrl: "http://localhost:3000",
          transformClient: HttpClient.withCookiesRef(cookies)
        })
        
        const originalEmail = Email.make("update-test@example.com")
        const updatedEmail = Email.make("updated-test@example.com")
        
        // Create user
        const createdUser = yield* client.accounts.createUser({
          payload: { email: originalEmail }
        })

        // Update user
        const updatedUser = yield* client.accounts.updateUser({
          path: { id: createdUser.id },
          payload: { email: updatedEmail }
        })

        yield* Effect.sync(() => {
          if (updatedUser.email !== updatedEmail) {
            throw new Error(`Expected email ${updatedEmail}, got ${updatedUser.email}`)
          }
          if (updatedUser.id !== createdUser.id) {
            throw new Error(`Expected id ${createdUser.id}, got ${updatedUser.id}`)
          }
        })
      }).pipe(Effect.provide(NodeHttpClient.layerUndici)))
  })

  describe("Group Management", () => {
    it.effect("creates a new group", () =>
      Effect.gen(function*() {
        const cookies = yield* Ref.make(Cookies.empty)
        const client = yield* HttpApiClient.make(Api, {
          baseUrl: "http://localhost:3000",
          transformClient: HttpClient.withCookiesRef(cookies)
        })
        
        // Create a user first for authentication
        yield* client.accounts.createUser({
          payload: { email: Email.make("group-test-user@example.com") }
        })

        const groupData = { name: "Integration Test Group" }
        const group = yield* client.groups.create({
          payload: groupData
        })

        yield* Effect.sync(() => {
          if (group.name !== groupData.name) {
            throw new Error(`Expected name ${groupData.name}, got ${group.name}`)
          }
          if (typeof group.id !== "number") {
            throw new Error(`Expected number id, got ${typeof group.id}`)
          }
          if (typeof group.ownerId !== "number") {
            throw new Error(`Expected number ownerId, got ${typeof group.ownerId}`)
          }
        })
      }).pipe(Effect.provide(NodeHttpClient.layerUndici)))

    it.effect("updates a group", () =>
      Effect.gen(function*() {
        const cookies = yield* Ref.make(Cookies.empty)
        const client = yield* HttpApiClient.make(Api, {
          baseUrl: "http://localhost:3000",
          transformClient: HttpClient.withCookiesRef(cookies)
        })
        
        // Create a user first for authentication
        yield* client.accounts.createUser({
          payload: { email: Email.make("group-update-user@example.com") }
        })

        // Create group first
        const group = yield* client.groups.create({
          payload: { name: "Group to Update" }
        })

        // Update group
        const updatedGroup = yield* client.groups.update({
          path: { id: group.id },
          payload: { name: "Updated Group Name" }
        })

        yield* Effect.sync(() => {
          if (updatedGroup.name !== "Updated Group Name") {
            throw new Error(`Expected name "Updated Group Name", got ${updatedGroup.name}`)
          }
          if (updatedGroup.id !== group.id) {
            throw new Error(`Expected id ${group.id}, got ${updatedGroup.id}`)
          }
        })
      }).pipe(Effect.provide(NodeHttpClient.layerUndici)))
  })

  describe("People Management", () => {
    it.effect("creates a new person in a group", () =>
      Effect.gen(function*() {
        const cookies = yield* Ref.make(Cookies.empty)
        const client = yield* HttpApiClient.make(Api, {
          baseUrl: "http://localhost:3000",
          transformClient: HttpClient.withCookiesRef(cookies)
        })
        
        // Create a user and group for people tests
        yield* client.accounts.createUser({
          payload: { email: Email.make("people-test-user@example.com") }
        })

        const group = yield* client.groups.create({
          payload: { name: "People Test Group" }
        })

        const personData = {
          firstName: "Integration",
          lastName: "Test",
          dateOfBirth: Option.none()
        }
        
        const person = yield* client.people.create({
          path: { groupId: group.id },
          payload: personData
        })

        yield* Effect.sync(() => {
          if (person.firstName !== personData.firstName) {
            throw new Error(`Expected firstName ${personData.firstName}, got ${person.firstName}`)
          }
          if (person.lastName !== personData.lastName) {
            throw new Error(`Expected lastName ${personData.lastName}, got ${person.lastName}`)
          }
          if (person.groupId !== group.id) {
            throw new Error(`Expected groupId ${group.id}, got ${person.groupId}`)
          }
          if (typeof person.id !== "number") {
            throw new Error(`Expected number id, got ${typeof person.id}`)
          }
        })
      }).pipe(Effect.provide(NodeHttpClient.layerUndici)))

    it.effect("retrieves a person by ID", () =>
      Effect.gen(function*() {
        const cookies = yield* Ref.make(Cookies.empty)
        const client = yield* HttpApiClient.make(Api, {
          baseUrl: "http://localhost:3000",
          transformClient: HttpClient.withCookiesRef(cookies)
        })
        
        // Create setup data
        yield* client.accounts.createUser({
          payload: { email: Email.make("person-retrieve-user@example.com") }
        })

        const group = yield* client.groups.create({
          payload: { name: "Person Retrieve Group" }
        })

        // Create person first
        const createdPerson = yield* client.people.create({
          path: { groupId: group.id },
          payload: {
            firstName: "Retrieve",
            lastName: "Test",
            dateOfBirth: Option.none()
          }
        })

        // Retrieve person
        const retrievedPerson = yield* client.people.findById({
          path: { id: createdPerson.id }
        })

        yield* Effect.sync(() => {
          if (retrievedPerson.id !== createdPerson.id) {
            throw new Error(`Expected id ${createdPerson.id}, got ${retrievedPerson.id}`)
          }
          if (retrievedPerson.firstName !== "Retrieve") {
            throw new Error(`Expected firstName "Retrieve", got ${retrievedPerson.firstName}`)
          }
          if (retrievedPerson.lastName !== "Test") {
            throw new Error(`Expected lastName "Test", got ${retrievedPerson.lastName}`)
          }
        })
      }).pipe(Effect.provide(NodeHttpClient.layerUndici)))
  })

  describe("Error Handling", () => {
    it.effect("handles user not found", () =>
      Effect.gen(function*() {
        const cookies = yield* Ref.make(Cookies.empty)
        const client = yield* HttpApiClient.make(Api, {
          baseUrl: "http://localhost:3000",
          transformClient: HttpClient.withCookiesRef(cookies)
        })
        
        // Create a user for authentication
        yield* client.accounts.createUser({
          payload: { email: Email.make("error-test-user@example.com") }
        })

        const result = yield* pipe(
          client.accounts.getUser({
            path: { id: UserId.make(99999) }
          }),
          Effect.flip
        )

        yield* Effect.sync(() => {
          if (result._tag !== "Unauthorized") {
            throw new Error(`Expected "Unauthorized", got ${result._tag}`)
          }
        })
      }).pipe(Effect.provide(NodeHttpClient.layerUndici)))

    it.effect("handles group not found", () =>
      Effect.gen(function*() {
        const cookies = yield* Ref.make(Cookies.empty)
        const client = yield* HttpApiClient.make(Api, {
          baseUrl: "http://localhost:3000",
          transformClient: HttpClient.withCookiesRef(cookies)
        })
        
        // Create a user for authentication
        yield* client.accounts.createUser({
          payload: { email: Email.make("group-error-user@example.com") }
        })

        const result = yield* pipe(
          client.groups.update({
            path: { id: GroupId.make(99999) },
            payload: { name: "Non-existent" }
          }),
          Effect.flip
        )

        yield* Effect.sync(() => {
          if (result._tag !== "GroupNotFound") {
            throw new Error(`Expected "GroupNotFound", got ${result._tag}`)
          }
        })
      }).pipe(Effect.provide(NodeHttpClient.layerUndici)))

    it.effect("handles person not found", () =>
      Effect.gen(function*() {
        const cookies = yield* Ref.make(Cookies.empty)
        const client = yield* HttpApiClient.make(Api, {
          baseUrl: "http://localhost:3000",
          transformClient: HttpClient.withCookiesRef(cookies)
        })
        
        // Create a user for authentication
        yield* client.accounts.createUser({
          payload: { email: Email.make("person-error-user@example.com") }
        })

        const result = yield* pipe(
          client.people.findById({
            path: { id: PersonId.make(99999) }
          }),
          Effect.flip
        )

        yield* Effect.sync(() => {
          if (result._tag !== "Unauthorized") {
            throw new Error(`Expected "Unauthorized", got ${result._tag}`)
          }
        })
      }).pipe(Effect.provide(NodeHttpClient.layerUndici)))
  })
})
