package observability

import (
	"context"
	"net/http"
	"strings"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.37.0"
	"go.opentelemetry.io/otel/trace"
)

const TraceIDHeader = "X-Trace-Id"

type TracingConfig struct {
	ServiceName  string
	Environment  string
	OTLPEndpoint string
}

func ConfigureTracing(ctx context.Context, cfg TracingConfig) (func(context.Context) error, error) {
	serviceName := cfg.ServiceName
	if strings.TrimSpace(serviceName) == "" {
		serviceName = "exponential-api"
	}

	res, err := resource.New(ctx,
		resource.WithAttributes(
			semconv.ServiceName(serviceName),
			semconv.DeploymentEnvironmentName(cfg.Environment),
		),
	)
	if err != nil {
		return nil, err
	}

	options := []sdktrace.TracerProviderOption{
		sdktrace.WithResource(res),
		sdktrace.WithSampler(sdktrace.ParentBased(sdktrace.AlwaysSample())),
	}

	if endpoint := strings.TrimSpace(cfg.OTLPEndpoint); endpoint != "" {
		exporter, err := otlptracehttp.New(ctx,
			otlptracehttp.WithEndpoint(endpoint),
			otlptracehttp.WithInsecure(),
		)
		if err != nil {
			return nil, err
		}
		options = append(options, sdktrace.WithBatcher(exporter))
	}

	provider := sdktrace.NewTracerProvider(options...)
	otel.SetTracerProvider(provider)
	otel.SetTextMapPropagator(propagation.TraceContext{})
	return provider.Shutdown, nil
}

func TraceMiddleware(serviceName string) func(http.Handler) http.Handler {
	tracer := otel.Tracer(serviceName)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := otel.GetTextMapPropagator().Extract(r.Context(), propagation.HeaderCarrier(r.Header))
			ctx, span := tracer.Start(ctx, r.Method+" "+r.URL.Path,
				trace.WithSpanKind(trace.SpanKindServer),
				trace.WithAttributes(
					semconv.HTTPRequestMethodKey.String(r.Method),
					semconv.URLPath(r.URL.Path),
					attribute.String("http.route", r.URL.Path),
				),
			)
			defer span.End()

			if spanContext := span.SpanContext(); spanContext.IsValid() {
				w.Header().Set(TraceIDHeader, spanContext.TraceID().String())
			}

			recorder := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
			next.ServeHTTP(recorder, r.WithContext(ctx))
			span.SetAttributes(semconv.HTTPResponseStatusCode(recorder.status))
			if recorder.status >= http.StatusInternalServerError {
				span.SetStatus(codes.Error, http.StatusText(recorder.status))
			}
		})
	}
}
