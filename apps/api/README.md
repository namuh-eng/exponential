# exponential Go API

The Go API is the headless backend for exponential. It is mounted directly on
`/v1/*` for SDK/CLI clients and behind the web/ALB `/api/*` prefix for browser
traffic.

Useful local checks:

```bash
curl http://localhost:7016/healthz
curl http://localhost:7016/metrics
curl http://localhost:7016/metrics/red
curl http://localhost:7016/api/healthz
curl http://localhost:7016/api/metrics
```

`/metrics` and `/api/metrics` return Prometheus text metrics for durable
scraping and aggregation. `/metrics/red` remains a JSON, in-process RED
snapshot for quick debugging.

Runtime configuration uses `EXPONENTIAL_API_*` variables for process settings
such as `EXPONENTIAL_API_DATABASE_URL`, `EXPONENTIAL_API_REDIS_URL`, and
`EXPONENTIAL_API_ADDR`. Auth, OAuth, attachment, and inbound-email feature flags
are shared with the web process through the root `.env`; see `.env.example` and
`docs/self-hosting.md`.
