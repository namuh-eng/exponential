FROM golang:1.25-alpine AS builder
WORKDIR /src/apps/api
COPY apps/api/go.mod apps/api/go.sum ./
RUN go mod download
COPY apps/api ./
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/exponential-api ./cmd/api

FROM alpine:3.22
RUN adduser -D -H -u 10001 api
USER api
COPY --from=builder /out/exponential-api /usr/local/bin/exponential-api
EXPOSE 3016
ENTRYPOINT ["exponential-api"]
