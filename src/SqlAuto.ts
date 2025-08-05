import { Config, Effect, Layer, Option } from "effect"
import * as SqliteConfig from "./Sql.js"
import * as PostgresConfig from "./SqlPostgres.js"

// Environment-based SQL layer selection
export const SqlLive = Effect.gen(function* () {
  // Check if PostgreSQL environment variables are provided
  const dbHost = yield* Config.option(Config.string("DATABASE_HOST"))
  const dbUrl = yield* Config.option(Config.string("DATABASE_URL"))
  const nodeEnv = yield* Config.string("NODE_ENV").pipe(Config.withDefault("development"))
  
  // Use PostgreSQL if:
  // 1. DATABASE_HOST is provided, OR
  // 2. DATABASE_URL is provided, OR  
  // 3. NODE_ENV is production
  if (Option.isSome(dbHost) || Option.isSome(dbUrl) || nodeEnv === "production") {
    console.log("🐘 Using PostgreSQL database configuration")
    return PostgresConfig.SqlLive
  } else {
    console.log("🗃️  Using SQLite database configuration")
    return SqliteConfig.SqlLive
  }
}).pipe(
  Effect.orElse(() => {
    console.log("🗃️  Fallback to SQLite database configuration")
    return Effect.succeed(SqliteConfig.SqlLive)
  }),
  Layer.unwrapEffect
)

// Test layer selection
export const SqlTest = Effect.gen(function* () {
  const dbHost = yield* Config.option(Config.string("DATABASE_HOST"))
  const dbUrl = yield* Config.option(Config.string("DATABASE_URL"))
  
  if (Option.isSome(dbHost) || Option.isSome(dbUrl)) {
    return PostgresConfig.SqlTest
  } else {
    return SqliteConfig.SqlTest
  }
}).pipe(
  Effect.orElse(() => Effect.succeed(SqliteConfig.SqlTest)),
  Layer.unwrapEffect
)
