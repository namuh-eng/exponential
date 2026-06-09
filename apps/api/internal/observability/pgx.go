package observability

import (
	"context"
	"strings"
	"unicode"

	"github.com/jackc/pgx/v5"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
)

type pgxTraceSpanKey struct{}

// PGXTracer creates child spans for Postgres Query, QueryRow, and Exec calls.
type PGXTracer struct{}

func (PGXTracer) TraceQueryStart(ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryStartData) context.Context {
	operation := sqlOperation(data.SQL)
	ctx, span := otel.Tracer("exponential-api/postgres").Start(ctx, "postgres "+operation,
		trace.WithSpanKind(trace.SpanKindClient),
		trace.WithAttributes(
			attribute.String("db.system.name", "postgresql"),
			attribute.String("db.operation.name", operation),
			attribute.String("db.query.text", compactSQL(data.SQL)),
		),
	)
	return context.WithValue(ctx, pgxTraceSpanKey{}, span)
}

func (PGXTracer) TraceQueryEnd(ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryEndData) {
	span, ok := ctx.Value(pgxTraceSpanKey{}).(trace.Span)
	if !ok || span == nil {
		return
	}
	defer span.End()
	if data.CommandTag.String() != "" {
		span.SetAttributes(attribute.String("db.response.status_code", data.CommandTag.String()))
	}
	if data.Err != nil {
		span.RecordError(data.Err)
		span.SetStatus(codes.Error, data.Err.Error())
	}
}

func sqlOperation(sql string) string {
	fields := strings.Fields(sql)
	if len(fields) == 0 {
		return "query"
	}
	return strings.ToLower(fields[0])
}

func compactSQL(sql string) string {
	compacted := strings.Map(func(r rune) rune {
		if unicode.IsSpace(r) {
			return ' '
		}
		return r
	}, strings.TrimSpace(sql))
	for strings.Contains(compacted, "  ") {
		compacted = strings.ReplaceAll(compacted, "  ", " ")
	}
	if len(compacted) > 500 {
		return compacted[:500] + "…"
	}
	return compacted
}
