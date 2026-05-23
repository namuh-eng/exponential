FROM golang:1.25-alpine AS builder
WORKDIR /src/apps/api
COPY apps/api/go.mod apps/api/go.sum ./
RUN go mod download
COPY apps/api ./
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/exponential-api ./cmd/api && \
    CGO_ENABLED=0 GOOS=linux go build -o /out/exponential-migrate ./cmd/migrate && \
    CGO_ENABLED=0 GOOS=linux go build -o /out/exponential-migrate-auth ./cmd/migrate-auth

FROM alpine:3.22
RUN adduser -D -H -u 10001 api
USER api
COPY --from=builder /out/exponential-api /usr/local/bin/exponential-api
COPY --from=builder /out/exponential-migrate /usr/local/bin/exponential-migrate
COPY --from=builder /out/exponential-migrate-auth /usr/local/bin/exponential-migrate-auth
COPY packages/proto/migrations /migrations
EXPOSE 3016
ENTRYPOINT ["exponential-api"]
