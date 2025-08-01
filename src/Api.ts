import { HttpApi, OpenApi } from "@effect/platform"
import { AccountsApi } from "./Accounts/Api.js"
import { GroupsApi } from "./Groups/Api.js"
import { PeopleApi } from "./People/Api.js"
import { HealthApi } from "./Health/Api.js"

export class Api extends HttpApi.empty
  .add(AccountsApi)
  .add(GroupsApi)
  .add(PeopleApi)
  .add(HealthApi)
  .annotate(OpenApi.Title, "Groups API")
{}
