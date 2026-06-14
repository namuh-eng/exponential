package http

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"go.uber.org/zap"
)

func TestRouterServesPublicAPIHealthAndMetricsAliases(t *testing.T) {
	router := NewRouter(zap.NewNop(), nil)

	for _, path := range []string{"/healthz", "/api/healthz", "/metrics", "/api/metrics", "/metrics/red", "/api/metrics/red"} {
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, path, nil))
		if recorder.Code != http.StatusOK {
			t.Fatalf("%s status = %d", path, recorder.Code)
		}
	}
}

func TestRouterPrometheusMetricsUseRouteLabels(t *testing.T) {
	router := NewRouter(zap.NewNop(), nil)

	router.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/api/healthz", nil))
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/metrics", nil))

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d body = %s", recorder.Code, recorder.Body.String())
	}
	if got := recorder.Header().Get("Content-Type"); !strings.HasPrefix(got, "text/plain; version=0.0.4") {
		t.Fatalf("content type = %q", got)
	}
	for _, expected := range []string{
		`exponential_http_requests_total{method="GET",route="/api/healthz",status="200"} 1`,
		`exponential_http_request_duration_seconds_count{method="GET",route="/api/healthz",status="200"} 1`,
	} {
		if !strings.Contains(recorder.Body.String(), expected) {
			t.Fatalf("Prometheus output missing %q:\n%s", expected, recorder.Body.String())
		}
	}
}

func TestRouterServesFirstPartyAuthRoutes(t *testing.T) {
	t.Setenv("AUTH_GOOGLE_ID", "")
	t.Setenv("AUTH_GOOGLE_SECRET", "")
	router := NewRouter(zap.NewNop(), nil)

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/auth/provider-capabilities", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("provider capabilities status = %d body = %s", recorder.Code, recorder.Body.String())
	}

	recorder = httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/auth/google/start?callback_url=/team/ABC", nil))
	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("google start status = %d body = %s", recorder.Code, recorder.Body.String())
	}
}

func TestRouterServesPublicAPICollectionAlias(t *testing.T) {
	router := NewRouter(zap.NewNop(), nil)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/issues", nil))
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d body = %s", recorder.Code, recorder.Body.String())
	}
}

func TestRouterServesStripeWebhookWithoutAuth(t *testing.T) {
	t.Setenv("STRIPE_WEBHOOK_SIGNING_SECRET", "whsec_test")
	router := NewRouter(zap.NewNop(), nil)
	recorder := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/stripe/webhook", strings.NewReader(`{}`))

	router.ServeHTTP(recorder, req)

	if recorder.Code == http.StatusNotFound || recorder.Code == http.StatusUnauthorized {
		t.Fatalf("status = %d body = %s", recorder.Code, recorder.Body.String())
	}
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d body = %s", recorder.Code, recorder.Body.String())
	}
}

func TestMetricsAccessAllowedOutsideProduction(t *testing.T) {
	t.Setenv("EXPONENTIAL_API_ENVIRONMENT", "development")
	if !metricsAccessAllowed(httptest.NewRequest(http.MethodGet, "/metrics/red", nil)) {
		t.Fatal("metrics should remain available outside production")
	}
}

func TestMetricsAccessRequiresTokenInProduction(t *testing.T) {
	t.Setenv("EXPONENTIAL_API_ENVIRONMENT", "production")
	t.Setenv("EXPONENTIAL_METRICS_TOKEN", "secret")
	if metricsAccessAllowed(httptest.NewRequest(http.MethodGet, "/metrics/red", nil)) {
		t.Fatal("production metrics should reject requests without the token")
	}
	req := httptest.NewRequest(http.MethodGet, "/metrics/red", nil)
	req.Header.Set("X-Metrics-Token", "secret")
	if !metricsAccessAllowed(req) {
		t.Fatal("production metrics should allow matching token")
	}
	req = httptest.NewRequest(http.MethodGet, "/metrics", nil)
	req.Header.Set("Authorization", "Bearer secret")
	if !metricsAccessAllowed(req) {
		t.Fatal("production metrics should allow matching bearer token")
	}
}

func TestMetricsAccessDisabledInProductionWhenUnconfigured(t *testing.T) {
	t.Setenv("EXPONENTIAL_API_ENVIRONMENT", "production")
	t.Setenv("EXPONENTIAL_METRICS_TOKEN", "")
	req := httptest.NewRequest(http.MethodGet, "/metrics/red", nil)
	req.Header.Set("X-Metrics-Token", "secret")
	if metricsAccessAllowed(req) {
		t.Fatal("production metrics must stay disabled when no token is configured")
	}
}

func TestPrometheusMetricsEndpointUsesProductionGate(t *testing.T) {
	t.Setenv("EXPONENTIAL_API_ENVIRONMENT", "production")
	t.Setenv("EXPONENTIAL_METRICS_TOKEN", "secret")
	router := NewRouter(zap.NewNop(), nil)

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/metrics", nil))
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("missing token status = %d body = %s", recorder.Code, recorder.Body.String())
	}

	recorder = httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/metrics", nil)
	req.Header.Set("Authorization", "Bearer secret")
	router.ServeHTTP(recorder, req)
	if recorder.Code != http.StatusOK {
		t.Fatalf("bearer token status = %d body = %s", recorder.Code, recorder.Body.String())
	}
}
