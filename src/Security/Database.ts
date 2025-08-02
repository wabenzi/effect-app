import { SqlClient } from "@effect/sql"
import { SqliteClient, SqliteMigrator } from "@effect/sql-sqlite-node"
import { Effect, Layer } from "effect"
import { createHash } from 'crypto'

// Enhanced database configuration with security
const SecureClientLive = SqliteClient.layer({
  filename: "data/db.sqlite",
  // Enable WAL mode for better concurrency and crash recovery
  enableWal: true,
  // Set secure pragmas
  prepare: Effect.gen(function*() {
    const client = yield* SqlClient.SqlClient
    
    // Security and performance pragmas
    yield* client.execute("PRAGMA journal_mode = WAL")
    yield* client.execute("PRAGMA synchronous = NORMAL") 
    yield* client.execute("PRAGMA cache_size = 10000")
    yield* client.execute("PRAGMA temp_store = memory")
    yield* client.execute("PRAGMA mmap_size = 268435456") // 256MB
    
    // Security settings
    yield* client.execute("PRAGMA foreign_keys = ON") // Enforce FK constraints
    yield* client.execute("PRAGMA recursive_triggers = ON")
    
    // Disable potentially dangerous features in production
    if (process.env.NODE_ENV === 'production') {
      yield* client.execute("PRAGMA trusted_schema = OFF")
    }
  })
})

// Audit logging for sensitive operations
export interface AuditLog {
  readonly id: number
  readonly userId: number | null
  readonly action: string
  readonly entity: string
  readonly entityId: string
  readonly oldValues: string | null
  readonly newValues: string | null
  readonly ipAddress: string
  readonly userAgent: string
  readonly timestamp: Date
}

export const createAuditLog = (
  userId: number | null,
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'READ',
  entity: string,
  entityId: string,
  oldValues?: any,
  newValues?: any,
  request?: any
): Effect.Effect<void, Error, SqlClient.SqlClient> =>
  Effect.gen(function*() {
    const client = yield* SqlClient.SqlClient
    
    yield* client.execute(`
      INSERT INTO audit_logs (
        user_id, action, entity, entity_id, 
        old_values, new_values, ip_address, user_agent, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      userId,
      action,
      entity,
      entityId,
      oldValues ? JSON.stringify(oldValues) : null,
      newValues ? JSON.stringify(newValues) : null,
      request?.ip || 'unknown',
      request?.headers?.['user-agent'] || 'unknown',
      new Date().toISOString()
    ])
  })

// Database backup utility
export const createBackup = (): Effect.Effect<string, Error, SqlClient.SqlClient> =>
  Effect.gen(function*() {
    const client = yield* SqlClient.SqlClient
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-')
    const backupPath = `data/backups/db-backup-${timestamp}.sqlite`
    
    // Use SQLite VACUUM INTO for clean backup
    yield* client.execute(`VACUUM INTO '${backupPath}'`)
    
    return backupPath
  })

// Migration with audit log table
export const AuditMigration = SqliteMigrator.fromFileSystem([
  {
    id: 'create_audit_logs',
    sql: `
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        action TEXT NOT NULL,
        entity TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        old_values TEXT,
        new_values TEXT,
        ip_address TEXT NOT NULL,
        user_agent TEXT NOT NULL,
        timestamp DATETIME NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id)
      );
      
      CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity, entity_id);
    `
  }
])

// Export secure database layer
export const SecureSqlLive = Layer.provideMerge(
  AuditMigration,
  SecureClientLive
)
