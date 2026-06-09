#!/usr/bin/env bash
set -euo pipefail
DOCKERFILE="${1:-infra/docker/api.Dockerfile}"
grep -q 'gcr.io/distroless/static-debian12:nonroot' "$DOCKERFILE"
grep -q -- '-ldflags="-s -w"' "$DOCKERFILE"
grep -q 'ENTRYPOINT \["exponential-api"\]' "$DOCKERFILE"
