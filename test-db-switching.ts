#!/usr/bin/env tsx

import { Effect } from "effect"
import { NodeRuntime } from "@effect/platform-node"
import { SqlLive } from "./src/SqlAuto.js"

// Test script to verify database auto-switching
const testDatabaseSwitching = Effect.gen(function* () {
  console.log("🧪 Testing database auto-switching logic...")
  console.log("Current environment variables:")
  console.log("DATABASE_HOST:", process.env.DATABASE_HOST || "(not set)")
  console.log("DATABASE_URL:", process.env.DATABASE_URL || "(not set)")
  console.log("NODE_ENV:", process.env.NODE_ENV || "(not set)")
  console.log()
  
  try {
    // This will trigger the auto-selection logic
    yield* Effect.scoped(
      Effect.gen(function* () {
        yield* SqlLive
        console.log("✅ Database layer initialized successfully")
      })
    )
  } catch (error) {
    console.log("❌ Database layer initialization failed:", error)
  }
})

NodeRuntime.runMain(testDatabaseSwitching)
