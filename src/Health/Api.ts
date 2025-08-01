import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "@effect/platform"

export class HealthApi extends HttpApiGroup.make("health")
  .add(
    HttpApiEndpoint.get("health", "/health").annotate(
      OpenApi.Summary,
      "Health check endpoint"
    )
  ) {}
