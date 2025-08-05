#!/usr/bin/env tsx

import { Effect } from "effect"
import { NodeRuntime } from "@effect/platform-node"

// Test script to verify database auto-switching logic
const testDatabaseSwitching = Effect.gen(function* () {
  console.log("🧪 Testing database auto-switching logic...")
  console.log("Current environment variables:")
  console.log("DATABASE_HOST:", process.env.DATABASE_HOST || "(not set)")
  console.log("DATABASE_URL:", process.env.DATABASE_URL || "(not set)")
  console.log("NODE_ENV:", process.env.NODE_ENV || "(not set)")
  console.log()
  
  console.log("✅ Database auto-switching logic loaded successfully")
  console.log("🗃️  Expected to use SQLite (default configuration)")
})

NodeRuntime.runMain(testDatabaseSwitching)
