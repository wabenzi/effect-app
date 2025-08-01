import { HttpApiBuilder } from "@effect/platform"
import { Effect } from "effect"
import { Api } from "../Api.js"

export const HealthHttp = HttpApiBuilder.group(Api, "health", (handlers) =>
  handlers.handle("health", () =>
    Effect.succeed({
      status: "healthy",
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    })
  )
)
