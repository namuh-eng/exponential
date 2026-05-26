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
