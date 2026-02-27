# AGENTS.md

## Project Purpose
`plc-cloud` is a cloud server for PLC/ESP32 controllers with a web UI.

Main responsibilities:
- authenticate web users;
- keep online device sessions alive;
- proxy protocol commands between browser and devices using `proto.json`.

## Runtime Architecture
- HTTP server: Express + REST API + static files from `public/`.
- Two WebSocket endpoints on the same HTTP server:
- `/ws/device` for ESP32 devices.
- `/ws/web` for browser clients.
- Persistent data is stored in JSON files under `data/`.
- Live online state is kept in memory (`DeviceRegistry`).

Data flow:
1. Device connects to `/ws/device` and sends `hello` with `auth.api_key`.
2. Server validates key in `DevicesDb`, creates session, returns `hello_ack` with `session_id`.
3. Device sends `result/event/ack`; server updates registry state and broadcasts `device_update`.
4. Browser sends `send_get/send_cmd` on `/ws/web`; server forwards to device session.

## Backend Modules (`src/`)

### `src/index.js`
- Entry point.
- Builds app via `AppContainer`, calls `init()`, then `listen()`.
- Uses logger format: `[YYYY-MM-DD][HH:mm:ss][LEVEL][SCOPE] message`.
- Current bind host is hardcoded to `192.168.1.108`; port is `PORT` or `3000`.

### `src/app/AppContainer.js`
- Resolves project paths:
- `data/`, `public/`, `proto.json`.
- Passes defaults into `AppServer`:
- `defaultObjects: ['Kvartira', 'Dacha', 'Derevnya']` (actual runtime values in code are Russian strings)
- `onlineTtlMs: 30000`

### `src/app/AppServer.js`
- Main app orchestrator.
- On `init()`:
- ensures data directory exists;
- builds datastores via `DatastoreFactory`;
- builds HTTP via `HttpFactory`;
- builds WS via `WsFactory`;
- starts timers:
- stale device cleanup every 5s;
- device ping loop every 10s.
- Broadcasts `device_offline` when session is disconnected/expired.

### `src/app/factories/DatastoreFactory.js`
- Creates `UsersDb` and `DevicesDb`.
- Calls `init()` for both.
- Seeds demo device only if `PLC_CLOUD_SEED_SAMPLE=1`.

### `src/app/factories/HttpFactory.js`
- Configures middleware:
- `express.json()`
- `cookie-parser`
- `express.static(publicDir)`
- Mounts API routes via `ApiRouter`.
- Returns Express app and Node HTTP server.

### `src/app/factories/WsFactory.js`
- Creates two `WebSocketServer` instances with `noServer: true`.
- Routes upgrades by URL prefix:
- `/ws/device` -> `DeviceWsServer`
- `/ws/web` -> `WebWsServer`
- Injects device WS into web WS (`setDeviceWs`) for command forwarding.

### `src/http/ApiRouter.js`
- REST API with cookie session auth middleware (`requireAuth()`).
- Endpoints:
- `POST /api/login`, `POST /api/logout`
- `GET /api/objects`
- `GET /api/devices?object=...`
- `GET /api/device/:id`
- `GET /api/admin/devices`
- `POST /api/admin/objects`
- `DELETE /api/admin/objects/:name`
- `PUT /api/admin/objects/:name`
- `PUT /api/admin/objects/:name/icon`
- `POST /api/admin/devices`
- `PUT /api/admin/devices/:id`
- `POST /api/admin/devices/:id/rotate_key`
- `DELETE /api/admin/devices/:id`

Important behavior:
- rotating key or deleting device triggers force disconnect callback;
- object delete is blocked when linked devices exist.

### `src/ws/DeviceWsServer.js`
- Handles device connections and protocol validation.
- Validates envelope fields (`v`, `type`, `id`).
- Handshake:
- requires `auth.api_key` in `hello`;
- stores device session;
- sends `hello_ack` with `session_id` and initial request hints.
- Session safety:
- 10s hello timeout;
- all non-hello messages require matching `session_id`;
- invalid session closes socket.
- Message handling:
- `ping` -> `pong`;
- `result` and `ack`: merge `payload.data` into registry state;
- `event`: merge event data and `last_event`.
- After state changes, builds summary and notifies web layer callback.
- Exposes command methods:
- `sendGet(deviceId, what, unit, nodeId)`
- `sendCmd(deviceId, controller, action, args, unit, nodeId)`
- `pingAll()` sends both low-level ws ping and protocol ping.

### `src/ws/WebWsServer.js`
- Authenticates browser WS by `session` cookie token in `SessionStore`.
- Supports per-client device subscriptions:
- `subscribe_device`
- `unsubscribe_device`
- Supports browser commands:
- `list_devices`
- `send_get`
- `send_cmd`
- Broadcast channels:
- full broadcast: `device_online`, `device_offline`
- subscription broadcast: `device_update` only to subscribed clients.

### `src/state/SessionStore.js`
- In-memory user sessions (`Map`).
- Token generation via `crypto.randomUUID()`.
- No TTL and no persistence across server restart.

### `src/state/DeviceRegistry.js`
- In-memory device session registry.
- Maps:
- `sessions: deviceId -> sessionInfo`
- `socketToDevice: ws -> deviceId`
- Responsibilities:
- attach/detach device sockets;
- update `lastSeenMs`;
- online check by TTL;
- keep merged runtime state (`system/controllers/stack/...`);
- build UI summary objects;
- list online devices by object;
- list all devices with online flags;
- expire stale sessions and close sockets.

### `src/db/UsersDb.js`
- JSON file backend for users: `data/users.json`.
- Creates default `admin` user with empty password hash (`sha256('')`) if missing.
- Exposes username lookup and credential validation.

### `src/db/DevicesDb.js`
- JSON file backend for devices/objects: `data/devices.json`.
- Stores:
- `objects`: `{ name, icon }` entries (supports old string legacy format too).
- `devices`: `device_id`, `name`, `api_key`, `object_name`, `last_seen_ms`.
- Features:
- object CRUD + rename + icon update;
- device CRUD + rotate key;
- lookup by api key and device id;
- update last seen;
- upsert by api key during hello.
- Object icons are normalized to allowed values:
- `apartment`, `house`, `dacha`, `garage`, `garden`.
- Invalid icon falls back to `house`.

### `src/utils/Logger.js`
- Small scoped logger with `child(scope)`.
- Levels: `info`, `warn`, `error`, `debug`.
- Output format required by project style.

### `src/utils/crypto.js`
- `sha256(value)` utility for passwords.
- `generateApiKey()` utility for device keys.

## Frontend Modules (`public/`)

### `public/index.html`
- Single-page shell with multiple view sections:
- login
- object selection
- settings
- online device list
- device status
- controllers overview
- sockets
- lights
- tanks
- security
- meteo
- network
- Top navigation:
- main menu: `Objects`, `Settings`
- device menu: `Status`, `Controllers`, `Network`

### `public/styles.css`
- Dark theme and responsive layout.
- Tile/card styles for each controller type.
- SVG visual states:
- socket on -> green glow;
- light on -> yellow glow;
- security alarm -> red glow.
- Pending command UI classes exist (`.pending`, inline waiting text styles).

### `public/js/state.js`
- Shared mutable UI state:
- ws socket reference;
- objects list;
- selected object;
- current online device list;
- selected device and latest merged snapshot;
- selected source scope (`local` or `stack`) and `node_id`.

### `public/js/api.js`
- Fetch wrapper with `credentials: include`.
- Throws JS `Error` with backend error code if request fails.

### `public/js/ws.js`
- Browser WS wrapper for `/ws/web`.
- Handles open/close/message events and forwards handlers to app layer.

### `public/js/ui.js`
- DOM renderer and view controller for all screens.
- Contains inline SVG generators for:
- object icons (`apartment`, `house`, `dacha`, `garage`, `garden`);
- device/controller icons.
- Main render methods:
- `renderObjects`, `renderDevices`
- `renderDevice`, `renderNetwork`
- `renderSockets`, `renderLights`, `renderTanks`, `renderSecurity`, `renderMeteo`
- `renderAdminDevices`, `renderAdminObjects`
- `renderScopeOptions` for local/stack node selector.

### `public/js/main.js`
- Main frontend orchestrator.
- Handles:
- login/logout flow;
- object/device loading;
- page navigation and back actions;
- WS subscriptions and command sends;
- periodic refresh (`DEVICE_POLL_INTERVAL_MS = 3000`);
- merge of incoming `device_update`.
- UX logic:
- if selected object has exactly one online device, auto-open it;
- source selector applies to status/controller pages (`local` or `stack:N`);
- after control commands, delayed refresh requests are sent to re-sync UI.

## Protocol Contract
- Source of truth: `proto.json`.
- Device messages must match protocol `version`.
- Auth model:
- `hello`: `auth.api_key` required.
- all next messages: valid `session_id` required.
- Supports `unit: local|stack` and optional `node_id` for stack/slave routing.
- UI currently consumes summaries built from:
- `system`
- `controllers`
- `stack`
- `last_event`

## Data Files (`data/`)

### `data/users.json`
```json
{ "users": [{ "username": "...", "password_hash": "..." }] }
```

### `data/devices.json`
```json
{
  "objects": [{ "name": "...", "icon": "house" }],
  "devices": [
    {
      "device_id": 123,
      "name": "PLC",
      "api_key": "...",
      "object_name": "...",
      "last_seen_ms": 0
    }
  ]
}
```

## Known Constraints and Risks
- User sessions are in-memory only; restart drops all login sessions.
- Online device state is in-memory only; restart shows devices offline until new device traffic.
- Online status depends on TTL (`onlineTtlMs = 30000`) and heartbeat activity.
- JSON file storage has no transaction/locking layer; concurrent writes can race.
- No role model, no fine-grained authorization.
- No built-in rate limiting or CSRF protections.
- Existing data may contain mojibake object names from older encoding issues.

## Extension Guide
- Add a new controller feature:
1. Extend `proto.json` types/commands.
2. Add renderer support in `public/js/ui.js`.
3. Add actions/events in `public/js/main.js`.
4. Use existing `send_get/send_cmd` flow through WS servers.
- Recommended env tunables to introduce:
- `HOST`, `PORT`
- `ONLINE_TTL_MS`
- `PING_INTERVAL_MS`
- For production hardening:
- move JSON storage to a DB;
- persist sessions with TTL;
- add API/WS rate limiting and audit logging.
