# Running the system

From `F1Analytics`:

```powershell
docker compose up --build -d
```

| Service | Host | Container | Role |
| --- | --- | --- | --- |
| web | 127.0.0.1:18701 | 80 | UI, `/v1`, and the timing proxies |
| api | 127.0.0.1:4010 | 80 | Schedule API |
| realtime | 127.0.0.1:4000 | 80 | Live timing |
| timescaledb | 127.0.0.1:18732 | 5432 | Stored sessions (`f1analysis`) |

Host port overrides are `F1A_UI_PORT`, `F1A_SCHEDULE_PORT`, `F1A_REALTIME_PORT`, and `F1A_TIMESCALE_PORT`. `API_PORT` and `UI_PORT` in `.env` do not change these mappings.

The tunnel, when started, targets `http://127.0.0.1:18701`. Leave it stopped while `AUTH_REQUIRED=0`.
