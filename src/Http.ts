import { HttpApiBuilder, HttpApiSwagger, HttpMiddleware, HttpServer, HttpServerRequest } from "@effect/platform"
import { NodeHttpServer } from "@effect/platform-node"
import { Effect, Layer, Console } from "effect"
import { createServer } from "http"
import { HttpAccountsLive } from "./Accounts/Http.js"
import { Api } from "./Api.js"
import { HttpGroupsLive } from "./Groups/Http.js"
import { HttpPeopleLive } from "./People/Http.js"
import { HealthHttp } from "./Health/Http.js"
// Security middleware imports for future integration
// import { rateLimitMiddleware, RateLimitConfig } from "./Http/RateLimit.js"
// import { securityHeadersMiddleware } from "./Http/SecurityHeaders.js"
// import { validationMiddleware } from "./Http/Validation.js"

// Custom middleware to log full HTTP payload
const payloadLogger = HttpMiddleware.make((app) =>
  HttpServerRequest.HttpServerRequest.pipe(
    Effect.tap((request) =>
      Effect.gen(function*() {
        // Log request details
        yield* Console.log("=== HTTP REQUEST ===")
        yield* Console.log(`Method: ${request.method}`)
        yield* Console.log(`URL: ${request.url}`)
        yield* Console.log("Headers:", JSON.stringify(request.headers, null, 2))

        // Log request body if present
        const bodyText = yield* request.text.pipe(
          Effect.orElse(() => Effect.succeed("[Unable to read request body]"))
        )
        yield* Console.log("Request Body:", bodyText)
      })
    ),
    Effect.flatMap(() => app),
    Effect.tap((response) =>
      Effect.gen(function*() {
        // Log response details
        yield* Console.log("=== HTTP RESPONSE ===")
        yield* Console.log(`Status: ${response.status}`)
        yield* Console.log("Response Headers:", JSON.stringify(response.headers, null, 2))
        yield* Console.log("Response body logging skipped to preserve stream")
        yield* Console.log("========================")
      })
    )
  )
)

// TODO: Security middleware integration
// const rateLimitConfig: RateLimitConfig = {
//   maxRequests: 100,
//   windowMs: 60000, // 1 minute
//   blockDurationMs: 300000 // 5 minutes
// }

// TODO: Compose security middleware when ready
// const securityMiddleware = (app: any) =>
//   securityHeadersMiddleware(
//     validationMiddleware(
//       rateLimitMiddleware(rateLimitConfig)(app)
//     )
//   )

const ApiLive = Layer.provide(HttpApiBuilder.api(Api), [
  HttpAccountsLive,
  HttpGroupsLive,
  HttpPeopleLive,
  HealthHttp
])

export const HttpLive = HttpApiBuilder.serve((app) =>
  payloadLogger(
    HttpMiddleware.logger(app)
    // TODO: Add security middleware when integration is complete
    // securityMiddleware(
    //   HttpMiddleware.logger(app)
    // )
  )
).pipe(
  Layer.provide(HttpApiSwagger.layer()),
  Layer.provide(HttpApiBuilder.middlewareOpenApi()),
  Layer.provide(HttpApiBuilder.middlewareCors()),
  Layer.provide(ApiLive),
  HttpServer.withLogAddress,
  Layer.provide(NodeHttpServer.layer(createServer, { port: 3000 }))
)
