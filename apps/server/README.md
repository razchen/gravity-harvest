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
`server/data/gravity-harvest.sqlite` (gitignored); delete it to reset all saves.

### Configuration (env vars, or `server/.env`)

| Variable         | Default                         | Notes                                                  |
| ---------------- | ------------------------------- | ------------------------------------------------------ |
| `PORT`           | `4310`                          |                                                        |
| `DATABASE_PATH`  | `data/gravity-harvest.sqlite`   | Relative paths resolve against `server/`. `:memory:` ok |
| `CORS_ORIGIN`    | `http://localhost:5173`         | Comma-separated list allowed                           |
| `BODY_LIMIT`     | `10mb`                          | Max JSON body size                                     |
| `DEBUG_COMMANDS` | on unless `NODE_ENV=production` | Accept debug commands on the match socket (dev, tests) |
| `DB_SYNCHRONIZE` | `true`                          | TypeORM auto-schema sync (dev). Set `false` once migrations exist |
| `DB_LOGGING`     | `false`                         | Log SQL                                                |

### Tests

```bash
npm test          # unit tests (Vitest): SavesService against in-memory SQLite, config parsing
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
  database/               TypeORM/SQLite setup (autoLoadEntities; add migrations here later)
  health/                 GET /api/health
  saves/                  saves: list / read / delete over HTTP (written only by matches), entity, DTOs
  match/                  the match WebSocket (gateway, one MatchSession per connection), message checks, GET /api/scenarios
test/                     e2e tests
```

New features (accounts, lobbies, ...) go in their own module folder next to `saves/`, registering
entities with `TypeOrmModule.forFeature([...])`.

## API

All routes are under `/api`. Errors use Nest's standard shape:
`{ "statusCode": 400, "message": "..." | ["..."], "error": "Bad Request" }`.

```ts
interface SaveGame {
  id: string;               // UUID
  name: string;             // 1..80 chars
  scenario: string;         // 1..64 chars, e.g. "skirmish"
  kind: 'manual' | 'auto';  // autosaves: one slot per scenario
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
| `WS /api/match`         | the match protocol (`packages/shared/src/match.ts`) |             | origin outside `CORS_ORIGIN` is refused |

Saves can't be created or overwritten over HTTP: only a running match writes them (the `save` socket message), so a
player can't upload a doctored state. The stored state is a `SimSnapshot` and stays on the server.

### curl examples

```bash
API=http://localhost:4310/api

curl $API/health
curl $API/scenarios
curl "$API/saves?scenario=skirmish&limit=10"
curl $API/saves/<id>
curl -X DELETE -i $API/saves/<id>
```

## Storage notes

- Table `save_games` (snake_case columns). `state` is stored as JSON text in `state_json` and parsed on read.
- Timestamps are set by the service with millisecond precision (SQLite's `datetime('now')` is
  second-precision, which would make "newest first" ambiguous for quick successive saves).
- Indexes on `updated_at` and `(scenario, updated_at)` back the list query.
- WAL mode is enabled for the file database.
