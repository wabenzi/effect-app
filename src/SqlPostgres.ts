import { NodeContext } from "@effect/platform-node"
import { SqlClient } from "@effect/sql"
import { PgClient, PgMigrator } from "@effect/sql-pg"
import { Config, Effect, Layer, identity, Redacted } from "effect"
import { fileURLToPath } from "url"
import { makeTestLayer } from "./lib/Layer.js"

// PostgreSQL Client Layer with environment configuration
const PgClientLive = Effect.gen(function* () {
  const host = yield* Config.string("DATABASE_HOST").pipe(Config.withDefault("localhost"))
  const port = yield* Config.integer("DATABASE_PORT").pipe(Config.withDefault(5432))
  const database = yield* Config.string("DATABASE_NAME").pipe(Config.withDefault("effect_app"))
  const username = yield* Config.string("DATABASE_USERNAME").pipe(Config.withDefault("postgres"))
  const password = yield* Config.string("DATABASE_PASSWORD").pipe(Config.withDefault(""))
  const ssl = yield* Config.boolean("DATABASE_SSL").pipe(Config.withDefault(false))
  const maxConnections = yield* Config.integer("DATABASE_MAX_CONNECTIONS").pipe(Config.withDefault(10))

  return PgClient.layer({
    host,
    port,
    database,
    username,
    password: Redacted.make(password),
    ssl,
    maxConnections
  })
}).pipe(Layer.unwrapEffect)

// PostgreSQL Migrator Layer
const PgMigratorLive = PgMigrator.layer({
  loader: PgMigrator.fromFileSystem(
    fileURLToPath(new URL("./migrations", import.meta.url))
  )
}).pipe(Layer.provide(NodeContext.layer))

// Combined PostgreSQL Layer
export const SqlLive = PgMigratorLive.pipe(Layer.provideMerge(PgClientLive))

// Test layer with transaction support
export const SqlTest = makeTestLayer(SqlClient.SqlClient)({
  withTransaction: identity
})