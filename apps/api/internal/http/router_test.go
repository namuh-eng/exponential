package http

import (
	"encoding/json"
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

func TestRouterProxiesKratosWithPublicAPIAuthPrefixStripped(t *testing.T) {
	kratos := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/self-service/login/browser" {
			t.Fatalf("proxied path = %s", r.URL.Path)
		}
		if r.URL.RawQuery != "return_to=http%3A%2F%2Fapp.test" {
			t.Fatalf("proxied query = %s", r.URL.RawQuery)
		}
		_ = json.NewEncoder(w).Encode(map[string]string{"ok": "true"})
	}))
	defer kratos.Close()
	t.Setenv("EXPONENTIAL_API_KRATOS_URL", kratos.URL)

	router := NewRouter(zap.NewNop(), nil)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/auth/kratos/self-service/login/browser?return_to=http%3A%2F%2Fapp.test", nil))

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d body = %s", recorder.Code, recorder.Body.String())
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
