# Gravity Harvest game server

NestJS 12 + TypeORM 1 + SQLite (`better-sqlite3`). Runs matches (the simulation in `packages/sim`) over a WebSocket
at `/api/match`, stores saves, and lists scenarios. ESM, TypeScript strict. The match protocol is in
`packages/shared/src/match.ts`; see `docs/ARCHITECTURE.md` for how a match flows.

## Run

Requires Node >= 22.12.

```bash
cd apps/server
npm install
cp .env.example .env        # optional; defaults are the same values

npm run start:dev           # watch mode (nest start --watch)
# or
npm run build && npm start  # compiled (node dist/main)
```

The API is served at `http://localhost:4310/api`. The SQLite file is created on first start at
`server/data/gravity-harvest.sqlite` (gitignored); delete it to reset all saves. Every start runs any pending
migrations (see Storage notes) before serving.

### Configuration (env vars, or `server/.env`)

| Variable         | Default                         | Notes                                                  |
| ---------------- | ------------------------------- | ------------------------------------------------------ |
| `PORT`           | `4310`                          |                                                        |
| `DATABASE_PATH`  | `data/gravity-harvest.sqlite`   | Relative paths resolve against `server/`. `:memory:` ok |
| `CORS_ORIGIN`    | `http://localhost:5173`         | Comma-separated list allowed                           |
| `BODY_LIMIT`     | `10mb`                          | Max JSON body size                                     |
| `DEBUG_COMMANDS` | on unless `NODE_ENV=production` | Accept debug commands on the match socket (dev, tests) |
| `DB_SYNCHRONIZE` | on unless `NODE_ENV=production` | Also sync the schema to the entities after migrations (dev, tests). Never in production |
| `DB_LOGGING`     | `false`                         | Log SQL                                                |

### Tests

```bash
npm test          # unit tests (Vitest): SavesService and the migrations against in-memory SQLite, config, message checks
npm run test:e2e  # e2e tests (Vitest + supertest + ws): every endpoint, and matches over the socket
```

Tests never touch `data/gravity-harvest.sqlite`.

> Vitest is used instead of Jest because Nest 12 packages are ESM-only and Jest can only
> `require()` ESM on Node >= 24.9. This matches Nest 12's official ESM starter.

## Layout

```
src/
  main.ts                 bootstrap (loads .env, listens on PORT)
  app.module.ts           root module
  app.setup.ts            global prefix, body limit, CORS, ValidationPipe (shared with e2e tests)
  config/                 typed env parsing (AppConfig, APP_CONFIG token)
  database/               TypeORM/SQLite setup (autoLoadEntities, migrations run on start)
    migrations/           schema migrations, listed in migrations/index.ts
  health/                 GET /api/health
  saves/                  saves: list / read / delete over HTTP (written only by matches), per player; entity, DTOs
  match/                  the match WebSocket (gateway, one MatchSession per connection), message checks, GET /api/scenarios
test/                     e2e tests
```

New features (accounts, lobbies, ...) go in their own module folder next to `saves/`, registering
entities with `TypeOrmModule.forFeature([...])`, plus a migration for their tables.

## API

All routes are under `/api`. Errors use Nest's standard shape:
`{ "statusCode": 400, "message": "..." | ["..."], "error": "Bad Request" }`.

### Player id

There are no accounts. Each browser makes a random id once (`crypto.randomUUID()`, kept in localStorage; see
`apps/game/src/net/playerId.ts`) and sends it with every saves request as the `x-player-id` header and on the match
socket as `?player=<id>`. It must be a lowercase UUID. Saves belong to the id that made them: listing, reading,
deleting, resuming, overwriting and the autosave slot only ever see that player's saves, and another player's save
is a 404, the same as a missing one. A saves request without a valid id is a 400; a socket without one is refused
with 400. The id keeps players' saves apart; it is not a secret or a login (anyone who knows an id can use it).

Saves stored before owners existed have no owner and are hidden from everyone (kept in the table, not deleted).

```ts
interface SaveGame {
  id: string;               // UUID
  name: string;             // 1..80 chars
  scenario: string;         // 1..64 chars, e.g. "skirmish"
  kind: 'manual' | 'auto';  // autosaves: one slot per player and scenario
  version: number;          // integer >= 1 (SimSnapshot format version)
  gameTimeMs: number;       // integer >= 0
  thumbnail: string | null; // data:image/png|jpeg;base64,... (max 700,000 chars ≈ 512 KB image)
  state: object;            // the match snapshot; stored and used server-side only
  createdAt: string;        // ISO 8601
  updatedAt: string;        // ISO 8601
}
type SaveGameSummary = Omit<SaveGame, 'state'>;
```

| Method & path           | Body / query                                   | Success          | Errors              |
| ----------------------- | ---------------------------------------------- | ---------------- | ------------------- |
| `GET /api/health`       |                                                | 200 `{status, time}` |                 |
| `GET /api/scenarios`    |                                                | 200 `ScenarioSummary[]` (no layouts) |  |
| `GET /api/saves`        | `?scenario=<str>` `?kind=manual\|auto` `?limit=1..100` (default 50) | 200 `SaveGameSummary[]`, newest `updatedAt` first | 400 |
| `GET /api/saves/:id`    |                                                | 200 `SaveGameSummary` (never the state) | 400 bad UUID, 404 |
| `DELETE /api/saves/:id` |                                                | 204 (no body)    | 400, 404            |
| `WS /api/match?player=<id>` | the match protocol (`packages/shared/src/match.ts`) |          | 403 origin outside `CORS_ORIGIN`, 400 no valid player id |

Every `/api/saves` route needs the `x-player-id` header (400 without it) and only sees that player's saves.

Saves can't be created or overwritten over HTTP: only a running match writes them (the `save` socket message), so a
player can't upload a doctored state. The stored state is a `SimSnapshot` and stays on the server.

### curl examples

```bash
API=http://localhost:4310/api
ME="x-player-id: <your id>"   # from localStorage 'gravity-harvest:player-id' in the browser

curl $API/health
curl $API/scenarios
curl -H "$ME" "$API/saves?scenario=skirmish&limit=10"
curl -H "$ME" $API/saves/<id>
curl -H "$ME" -X DELETE -i $API/saves/<id>
```

## Storage notes

- The schema is owned by migrations (`src/database/migrations/`), run on every start (`migrationsRun`). Production
  never uses `synchronize`; in development and tests it runs after the migrations and has nothing to do while the
  entities match them. Changing an entity means adding a migration (copy the SQL from the failing
  `migrations.spec.ts`, which checks that the migrations build exactly what the entities describe) and listing it
  in `migrations/index.ts`. The first migration uses `IF NOT EXISTS`, so a database made by the old always-on
  `synchronize` adopts it and keeps its saves.
- Table `save_games` (snake_case columns). `state` is stored as JSON text in `state_json` and parsed on read.
  `owner` is the player id (NULL for saves from before owners: hidden).
- Timestamps are set by the service with millisecond precision (SQLite's `datetime('now')` is
  second-precision, which would make "newest first" ambiguous for quick successive saves).
- Indexes on `(owner, updated_at)` and `(owner, scenario, updated_at)` back the list query.
- WAL mode is enabled for the file database.
