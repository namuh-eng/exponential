FROM golang:1.25-alpine AS builder
WORKDIR /src/apps/api
COPY apps/api/go.mod apps/api/go.sum ./
RUN go mod download
COPY apps/api ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/exponential-api ./cmd/api && \
    CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/exponential-migrate ./cmd/migrate && \
    CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/exponential-migrate-auth ./cmd/migrate-auth

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=builder /out/exponential-api /usr/local/bin/exponential-api
COPY --from=builder /out/exponential-migrate /usr/local/bin/exponential-migrate
COPY --from=builder /out/exponential-migrate-auth /usr/local/bin/exponential-migrate-auth
COPY packages/proto/migrations /migrations
EXPOSE 3016
ENTRYPOINT ["exponential-api"]
