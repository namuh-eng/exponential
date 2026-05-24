package http

import (
	"encoding/json"
	stdhttp "net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/namuh-eng/exponential/apps/api/internal/account"
	"github.com/namuh-eng/exponential/apps/api/internal/agentruns"
	"github.com/namuh-eng/exponential/apps/api/internal/analytics"
	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"github.com/namuh-eng/exponential/apps/api/internal/authproviders"
	"github.com/namuh-eng/exponential/apps/api/internal/comments"
	"github.com/namuh-eng/exponential/apps/api/internal/documents"
	"github.com/namuh-eng/exponential/apps/api/internal/emojis"
	"github.com/namuh-eng/exponential/apps/api/internal/inbound"
	"github.com/namuh-eng/exponential/apps/api/internal/initiatives"
	"github.com/namuh-eng/exponential/apps/api/internal/integrations"
	"github.com/namuh-eng/exponential/apps/api/internal/issues"
	"github.com/namuh-eng/exponential/apps/api/internal/issuetemplates"
	"github.com/namuh-eng/exponential/apps/api/internal/labels"
	"github.com/namuh-eng/exponential/apps/api/internal/myissues"
	"github.com/namuh-eng/exponential/apps/api/internal/notifications"
	"github.com/namuh-eng/exponential/apps/api/internal/observability"
	"github.com/namuh-eng/exponential/apps/api/internal/projects"
	"github.com/namuh-eng/exponential/apps/api/internal/projectstatuses"
	"github.com/namuh-eng/exponential/apps/api/internal/projecttemplates"
	"github.com/namuh-eng/exponential/apps/api/internal/projectupdateconfigs"
	"github.com/namuh-eng/exponential/apps/api/internal/projectupdates"
	"github.com/namuh-eng/exponential/apps/api/internal/sidebar"
	syncapi "github.com/namuh-eng/exponential/apps/api/internal/sync"
	"github.com/namuh-eng/exponential/apps/api/internal/teams"
	"github.com/namuh-eng/exponential/apps/api/internal/testhelpers"
	"github.com/namuh-eng/exponential/apps/api/internal/tokens"
	"github.com/namuh-eng/exponential/apps/api/internal/views"
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
	authProvidersHandler := authproviders.Handler{DB: db}
	commentsHandler := comments.Handler{DB: db}
	documentsHandler := documents.Handler{DB: db}
	labelsHandler := labels.Handler{DB: db}
	r.Route("/v1", func(v1 chi.Router) {
		v1.Mount("/auth", authProvidersHandler.Routes())
		v1.Mount("/inbound", inbound.Handler{DB: db}.Routes())
		v1.Post("/oauth/token", authProvidersHandler.ExchangeOAuthToken)
		v1.Group(func(protected chi.Router) {
			protected.Use(authMiddleware.Require)
			protected.Post("/issues/{id}/comments", commentsHandler.CreateForIssue)
			protected.Post("/issues/{id}/reactions", commentsHandler.ToggleIssueReaction)
			protected.Delete("/issues/{id}/reactions", commentsHandler.DeleteIssueReaction)
			protected.Mount("/account", account.Handler{DB: db}.Routes())
			protected.Mount("/analytics", analytics.Handler{DB: db}.Routes())
			protected.Mount("/agent/runs", agentruns.Handler{DB: db}.Routes())
			protected.Patch("/comments/{id}", commentsHandler.Update)
			protected.Mount("/custom-emojis", emojis.Handler{DB: db}.Routes())
			protected.Mount("/document-folders", documentsHandler.FolderRoutes())
			protected.Mount("/document-settings", documentsHandler.SettingsRoutes())
			protected.Mount("/document-templates", documentsHandler.TemplateRoutes())
			protected.Delete("/comments/{id}", commentsHandler.Delete)
			protected.Post("/comments/{id}/reactions", commentsHandler.ToggleCommentReaction)
			protected.Mount("/integrations", integrations.Handler{DB: db}.Routes())
			protected.Mount("/initiatives", initiatives.Handler{DB: db}.Routes())
			protected.Mount("/issue-templates", issuetemplates.Handler{DB: db}.Routes())
			protected.Mount("/issues", issues.Handler{DB: db}.Routes())
			protected.Mount("/labels", labelsHandler.Routes())
			protected.Mount("/my-issues", myissues.Handler{DB: db}.Routes())
			protected.Mount("/notifications", notifications.Handler{DB: db}.Routes())
			protected.Get("/oauth/authorize", authProvidersHandler.AuthorizeOAuth)
			protected.Mount("/project-labels", labelsHandler.ProjectRoutes())
			protected.Mount("/project-statuses", projectstatuses.Handler{DB: db}.Routes())
			protected.Mount("/project-templates", projecttemplates.Handler{DB: db}.Routes())
			protected.Mount("/project-updates", projectupdates.Handler{DB: db}.Routes())
			protected.Mount("/project-update-configurations", projectupdateconfigs.Handler{DB: db}.Routes())
			protected.Mount("/personal-access-tokens", tokens.Handler{DB: db}.Routes())
			protected.Mount("/projects", projects.Handler{DB: db}.Routes())
			protected.Mount("/sidebar", sidebar.Handler{DB: db}.Routes())
			protected.Mount("/teams", teams.Handler{DB: db}.Routes())
			protected.Mount("/test", testhelpers.Handler{DB: db}.Routes())
			protected.Mount("/views", views.Handler{DB: db}.Routes())
			protected.Mount("/workspaces", workspaces.Handler{DB: db}.Routes())
			protected.Get("/sync/ws", syncapi.Handler{DB: db}.WebSocket)
		})
	})
	return r
}
