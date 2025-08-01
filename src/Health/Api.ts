import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "@effect/platform"
import { Schema } from "effect"

const HealthResponse = Schema.Struct({
  status: Schema.String,
  timestamp: Schema.String,
  uptime: Schema.Number
})

export class HealthApi extends HttpApiGroup.make("health")
  .add(
    HttpApiEndpoint.get("health", "/health")
      .addSuccess(HealthResponse)
      .annotate(
        OpenApi.Summary,
        "Health check endpoint"
      )
  ) {}
