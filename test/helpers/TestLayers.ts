import { AccountsRepo } from "app/Accounts/AccountsRepo"
import { UsersRepo } from "app/Accounts/UsersRepo"
import { Account, AccountId } from "app/Domain/Account"
import { Email } from "app/Domain/Email"
import { User, UserId } from "app/Domain/User"
import { GroupsRepo } from "app/Groups/Repo"
import { Group, GroupId } from "app/Domain/Group"
import { PeopleRepo } from "app/People/Repo"
import { Person, PersonId } from "app/Domain/Person"
import { makeTestLayer } from "app/lib/Layer"
import { accessTokenFromRedacted } from "app/Domain/AccessToken"
import { DateTime, Effect, Layer, Option, Redacted } from "effect"

// Mock data generators
export const mockAccount = (id = 123): Account => 
  new Account({
    id: AccountId.make(id),
    createdAt: Effect.runSync(DateTime.now),
    updatedAt: Effect.runSync(DateTime.now)
  })

export const mockUser = (id = 1, accountId = 123): User =>
  new User({
    id: UserId.make(id),
    email: Email.make("test@example.com"),
    accountId: AccountId.make(accountId),
    createdAt: Effect.runSync(DateTime.now),
    updatedAt: Effect.runSync(DateTime.now),
    accessToken: accessTokenFromRedacted(Redacted.make("test-uuid"))
  })

export const mockGroup = (id = 1, ownerId = 123): Group =>
  new Group({
    id: GroupId.make(id),
    ownerId: AccountId.make(ownerId),
    name: "Test Group",
    createdAt: Effect.runSync(DateTime.now),
    updatedAt: Effect.runSync(DateTime.now)
  })

export const mockPerson = (id = 1, groupId = 1): Person =>
  new Person({
    id: PersonId.make(id),
    groupId: GroupId.make(groupId),
    firstName: "John",
    lastName: "Doe",
    dateOfBirth: Option.none(),
    createdAt: Effect.runSync(DateTime.now),
    updatedAt: Effect.runSync(DateTime.now)
  })

// Test layer factories with default implementations
export const mockAccountsRepo = (overrides: Partial<AccountsRepo> = {}) =>
  makeTestLayer(AccountsRepo)({
    findById: (id: AccountId) => Effect.succeed(Option.some(mockAccount(id))),
    insert: (account) => Effect.succeed(mockAccount()),
    update: (account) => Effect.succeed(mockAccount(account.id)),
    ...overrides
  })

export const mockUsersRepo = (overrides: Partial<UsersRepo> = {}) =>
  makeTestLayer(UsersRepo)({
    findById: (id: UserId) => Effect.succeed(Option.some(mockUser(id))),
    findByAccessToken: (token) => Effect.succeed(Option.some(mockUser())),
    insert: (user) => Effect.succeed(mockUser()),
    update: (user) => Effect.succeed(mockUser(user.id)),
    ...overrides
  })

export const mockGroupsRepo = (overrides: Partial<GroupsRepo> = {}) =>
  makeTestLayer(GroupsRepo)({
    findById: (id: GroupId) => Effect.succeed(Option.some(mockGroup(id))),
    insert: (group) => Effect.succeed(mockGroup()),
    update: (group) => Effect.succeed(mockGroup(group.id)),
    ...overrides
  })

export const mockPeopleRepo = (overrides: Partial<PeopleRepo> = {}) =>
  makeTestLayer(PeopleRepo)({
    findById: (id: PersonId) => Effect.succeed(Option.some(mockPerson(id))),
    insert: (person) => Effect.succeed(mockPerson()),
    update: (person) => Effect.succeed(mockPerson(person.id)),
    ...overrides
  })

// Common test layers
export const mockRepoLayers = Layer.mergeAll(
  mockAccountsRepo(),
  mockUsersRepo(),
  mockGroupsRepo(),
  mockPeopleRepo()
)
