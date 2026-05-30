package http

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"go.uber.org/zap"
)

func TestRouterServesPublicAPIHealthAndMetricsAliases(t *testing.T) {
	router := NewRouter(zap.NewNop(), nil)

	for _, path := range []string{"/healthz", "/api/healthz", "/metrics/red", "/api/metrics/red"} {
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, path, nil))
		if recorder.Code != http.StatusOK {
			t.Fatalf("%s status = %d", path, recorder.Code)
		}
	}
}

func TestRouterServesFirstPartyAuthRoutes(t *testing.T) {
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
