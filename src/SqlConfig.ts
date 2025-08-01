import { NodeContext } from "@effect/platform-node"
import { SqlClient } from "@effect/sql"
import { SqliteClient, SqliteMigrator as SqliteMigratorClient } from "@effect/sql-sqlite-node"
import { identity, Layer } from "effect"
import { fileURLToPath } from "url"
import { makeTestLayer } from "./lib/Layer.js"

// SQLite configuration
const SqliteClientLive = SqliteClient.layer({
  filename: "data/db.sqlite"
})

const SqliteMigratorLive = SqliteMigratorClient.layer({
  loader: SqliteMigratorClient.fromFileSystem(
    fileURLToPath(new URL("./migrations", import.meta.url))
  )
}).pipe(Layer.provide(NodeContext.layer))

// SQL layer using SQLite
export const SqlLive = Layer.provideMerge(SqliteClientLive, SqliteMigratorLive)

export const SqlTest = makeTestLayer(SqlClient.SqlClient)({
  withTransaction: identity
})
