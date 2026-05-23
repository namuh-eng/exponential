package http

import (
	"encoding/json"
	stdhttp "net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"github.com/namuh-eng/exponential/apps/api/internal/issues"
	"github.com/namuh-eng/exponential/apps/api/internal/observability"
	syncapi "github.com/namuh-eng/exponential/apps/api/internal/sync"
	"github.com/namuh-eng/exponential/apps/api/internal/teams"
	"github.com/namuh-eng/exponential/apps/api/internal/tokens"
	"github.com/namuh-eng/exponential/apps/api/internal/workspaces"
	"go.uber.org/zap"
)

// NewRouter wires API routes.
func NewRouter(logger *zap.Logger, db *pgxpool.Pool) stdhttp.Handler {
	metrics := &observability.Metrics{}
	r := chi.NewRouter()
	r.Use(observability.RequestLogger(logger, metrics))
	r.Get("/healthz", func(w stdhttp.ResponseWriter, r *stdhttp.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(stdhttp.StatusOK)
		if err := json.NewEncoder(w).Encode(map[string]string{"status": "ok"}); err != nil {
			logger.Error("write health response", zap.Error(err))
		}
	})
	r.Get("/metrics/red", func(w stdhttp.ResponseWriter, r *stdhttp.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(stdhttp.StatusOK)
		if err := json.NewEncoder(w).Encode(observability.Snapshot(metrics)); err != nil {
			logger.Error("write metrics response", zap.Error(err))
		}
	})

	authMiddleware := auth.Middleware{DB: db}
	r.Route("/v1", func(v1 chi.Router) {
		v1.Group(func(protected chi.Router) {
			protected.Use(authMiddleware.Require)
			protected.Mount("/issues", issues.Handler{DB: db}.Routes())
			protected.Mount("/personal-access-tokens", tokens.Handler{DB: db}.Routes())
			protected.Mount("/teams", teams.Handler{DB: db}.Routes())
			protected.Mount("/workspaces", workspaces.Handler{DB: db}.Routes())
			protected.Get("/sync/ws", syncapi.Handler{DB: db}.WebSocket)
		})
	})
	return r
}
