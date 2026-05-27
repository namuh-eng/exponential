# exponential Go API

The Go API is the headless backend for exponential. It is mounted directly on
`/v1/*` for SDK/CLI clients and behind the web/ALB `/api/*` prefix for browser
traffic.

Useful local checks:

```bash
curl http://localhost:7016/healthz
curl http://localhost:7016/metrics/red
curl http://localhost:7016/api/healthz
```

Runtime configuration uses `EXPONENTIAL_API_*` variables for process settings
such as `EXPONENTIAL_API_DATABASE_URL`, `EXPONENTIAL_API_REDIS_URL`, and
`EXPONENTIAL_API_ADDR`. Auth, OAuth, attachment, and inbound-email feature flags
are shared with the web process through the root `.env`; see `.env.example` and
`docs/self-hosting.md`.
