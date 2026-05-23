package http

import (
	"encoding/json"
	stdhttp "net/http"

	"github.com/go-chi/chi/v5"
	"go.uber.org/zap"
)

// NewRouter wires the API routes that exist during Phase 0 scaffolding.
func NewRouter(logger *zap.Logger) stdhttp.Handler {
	r := chi.NewRouter()
	r.Get("/healthz", func(w stdhttp.ResponseWriter, r *stdhttp.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(stdhttp.StatusOK)
		if err := json.NewEncoder(w).Encode(map[string]string{"status": "ok"}); err != nil {
			logger.Error("write health response", zap.Error(err))
		}
	})
	return r
}
