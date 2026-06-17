package http

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	stdhttp "net/http"
	"os"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/namuh-eng/exponential/apps/api/internal/account"
	"github.com/namuh-eng/exponential/apps/api/internal/agentruns"
	"github.com/namuh-eng/exponential/apps/api/internal/analytics"
	"github.com/namuh-eng/exponential/apps/api/internal/attachments"
	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"github.com/namuh-eng/exponential/apps/api/internal/authproviders"
	"github.com/namuh-eng/exponential/apps/api/internal/billing"
	"github.com/namuh-eng/exponential/apps/api/internal/comments"
	"github.com/namuh-eng/exponential/apps/api/internal/demo"
	"github.com/namuh-eng/exponential/apps/api/internal/documents"
	"github.com/namuh-eng/exponential/apps/api/internal/email"
	"github.com/namuh-eng/exponential/apps/api/internal/emojis"
	"github.com/namuh-eng/exponential/apps/api/internal/inbound"
	"github.com/namuh-eng/exponential/apps/api/internal/initiatives"
	"github.com/namuh-eng/exponential/apps/api/internal/integrations"
	"github.com/namuh-eng/exponential/apps/api/internal/issues"
	"github.com/namuh-eng/exponential/apps/api/internal/issuetemplates"
	"github.com/namuh-eng/exponential/apps/api/internal/labels"
	"github.com/namuh-eng/exponential/apps/api/internal/mcp"
	"github.com/namuh-eng/exponential/apps/api/internal/myissues"
	"github.com/namuh-eng/exponential/apps/api/internal/notifications"
	"github.com/namuh-eng/exponential/apps/api/internal/observability"
	"github.com/namuh-eng/exponential/apps/api/internal/projects"
	"github.com/namuh-eng/exponential/apps/api/internal/projectstatuses"
	"github.com/namuh-eng/exponential/apps/api/internal/projecttemplates"
	"github.com/namuh-eng/exponential/apps/api/internal/projectupdateconfigs"
	"github.com/namuh-eng/exponential/apps/api/internal/projectupdates"
	"github.com/namuh-eng/exponential/apps/api/internal/ratelimit"
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
	r.Use(limitRequestBody(10 << 20))
	r.Use(observability.TraceMiddleware("exponential-api"))
	r.Use(observability.RequestLogger(logger, metrics))

	emailSender, err := email.New(context.Background())
	if err != nil {
		logger.Warn("email sender unavailable; magic-link sign-in will be disabled", zap.Error(err))
		emailSender = email.Disabled{}
	}

	healthHandler := func(w stdhttp.ResponseWriter, r *stdhttp.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(stdhttp.StatusOK)
		if err := json.NewEncoder(w).Encode(map[string]string{"status": "ok"}); err != nil {
			logger.Error("write health response", zap.Error(err))
		}
	}
	r.Get("/healthz", healthHandler)
	r.Get("/api/healthz", healthHandler)
	redMetricsHandler := func(w stdhttp.ResponseWriter, r *stdhttp.Request) {
		if !metricsAccessAllowed(r) {
			stdhttp.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(stdhttp.StatusOK)
		if err := json.NewEncoder(w).Encode(observability.Snapshot(metrics)); err != nil {
			logger.Error("write metrics response", zap.Error(err))
		}
	}
	prometheusMetricsHandler := func(w stdhttp.ResponseWriter, r *stdhttp.Request) {
		if !metricsAccessAllowed(r) {
			stdhttp.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
		w.WriteHeader(stdhttp.StatusOK)
		if _, err := w.Write([]byte(observability.Prometheus(metrics))); err != nil {
			logger.Error("write prometheus metrics response", zap.Error(err))
		}
	}
	r.Get("/metrics", prometheusMetricsHandler)
	r.Get("/api/metrics", prometheusMetricsHandler)
	r.Get("/metrics/red", redMetricsHandler)
	r.Get("/api/metrics/red", redMetricsHandler)

	mountAPIRoutes(r, "/v1", db, emailSender, logger)
	mountAPIRoutes(r, "/api", db, emailSender, logger)
	return r
}

func mountAPIRoutes(r chi.Router, prefix string, db *pgxpool.Pool, emailSender email.Sender, logger *zap.Logger) {
	authMiddleware := auth.Middleware{DB: db}
	authProvidersHandler := authproviders.Handler{DB: db, Email: emailSender}
	integrationsHandler := integrations.Handler{DB: db}
	stripeWebhookHandler := billing.NewStripeWebhookHandler(db, logger)
	commentsHandler := comments.Handler{DB: db}
	documentsHandler := documents.Handler{DB: db}
	labelsHandler := labels.Handler{DB: db}
	workspacesHandler := workspaces.Handler{DB: db}
	r.Route(prefix, func(v1 chi.Router) {
		v1.Get("/auth/session", authMiddleware.Session)
		v1.Post("/stripe/webhook", stripeWebhookHandler.ServeHTTP)
		v1.Group(func(publicAuth chi.Router) {
			publicAuth.Use(ratelimit.PublicMiddleware())
			publicAuth.Mount("/auth", authProvidersHandler.Routes())
		})
		v1.Group(func(publicDemo chi.Router) {
			publicDemo.Use(ratelimit.PublicMiddleware())
			publicDemo.Get("/demo/session", demo.Handler{DB: db}.Session)
		})
		v1.Group(func(publicProvider chi.Router) {
			publicProvider.Use(ratelimit.PublicMiddleware())
			publicProvider.Get("/integrations/slack/oauth/callback", integrationsHandler.SlackOAuthCallback)
			publicProvider.Get("/integrations/discord/oauth/callback", integrationsHandler.DiscordOAuthCallback)
			publicProvider.Post("/integrations/discord/interactions", integrationsHandler.DiscordInteractions)
			publicProvider.Get("/integrations/microsoft-teams/oauth/callback", integrationsHandler.MicrosoftTeamsOAuthCallback)
			publicProvider.Get("/integrations/sentry/oauth/callback", integrationsHandler.SentryOAuthCallback)
			publicProvider.Get("/integrations/salesforce/oauth/callback", integrationsHandler.SalesforceOAuthCallback)
			publicProvider.Post("/integrations/salesforce/issues/search", integrationsHandler.SalesforceIssueSearch)
			publicProvider.Post("/integrations/salesforce/issues/link", integrationsHandler.SalesforceIssueLink)
			publicProvider.Post("/integrations/salesforce/issues/create", integrationsHandler.SalesforceIssueCreate)
			publicProvider.Post("/integrations/salesforce/projects/search", integrationsHandler.SalesforceProjectSearch)
			publicProvider.Post("/integrations/salesforce/projects/link", integrationsHandler.SalesforceProjectLink)
			publicProvider.Get("/integrations/intercom/oauth/callback", integrationsHandler.IntercomOAuthCallback)
			publicProvider.Get("/integrations/gong/oauth/callback", integrationsHandler.GongOAuthCallback)
			publicProvider.Get("/integrations/github/setup/callback", integrationsHandler.GitHubSetupCallback)
			publicProvider.Post("/integrations/sentry/issues/search", integrationsHandler.SentryIssueSearch)
			publicProvider.Post("/integrations/sentry/issues/link", integrationsHandler.SentryIssueLink)
			publicProvider.Post("/integrations/sentry/issues/create", integrationsHandler.SentryIssueCreate)
			publicProvider.Post("/integrations/front/issues/search", integrationsHandler.FrontIssueSearch)
			publicProvider.Post("/integrations/front/issues/link", integrationsHandler.FrontIssueLink)
			publicProvider.Post("/integrations/front/issues/unlink", integrationsHandler.FrontIssueUnlink)
			publicProvider.Post("/integrations/front/issues/create", integrationsHandler.FrontIssueCreate)
			publicProvider.Post("/integrations/intercom/issues/search", integrationsHandler.IntercomIssueSearch)
			publicProvider.Post("/integrations/intercom/issues/status", integrationsHandler.IntercomIssueStatus)
			publicProvider.Post("/integrations/intercom/issues/link", integrationsHandler.IntercomIssueLink)
			publicProvider.Post("/integrations/intercom/issues/unlink", integrationsHandler.IntercomIssueUnlink)
			publicProvider.Post("/integrations/intercom/issues/create", integrationsHandler.IntercomIssueCreate)
			publicProvider.Post("/integrations/zendesk/tickets/search", integrationsHandler.ZendeskTicketSearch)
			publicProvider.Post("/integrations/zendesk/tickets/link", integrationsHandler.ZendeskTicketLink)
			publicProvider.Post("/integrations/zendesk/tickets/create", integrationsHandler.ZendeskTicketCreate)
			publicProvider.Post("/integrations/zendesk/tickets/status", integrationsHandler.ZendeskTicketStatus)

			publicProvider.Post("/integrations/microsoft-teams/activities", integrationsHandler.MicrosoftTeamsActivities)
			publicProvider.Post("/integrations/slack/events", integrationsHandler.SlackEvents)
			publicProvider.Post("/integrations/gitlab/webhook/{integrationID}", integrationsHandler.GitLabWebhook)
			publicProvider.Post("/integrations/gong/{integrationID}/calls", integrationsHandler.GongIngestCall)
			publicProvider.Post("/integrations/github/webhook", integrationsHandler.GitHubWebhook)
			publicProvider.Post("/integrations/github/webhook/{integrationID}", integrationsHandler.GitHubWebhookLegacy)
			publicProvider.Post("/integrations/slack/interactivity", integrationsHandler.SlackInteractivity)
		})
		v1.Mount("/inbound", inbound.Handler{DB: db}.Routes())
		v1.Post("/oauth/token", authProvidersHandler.ExchangeOAuthToken)
		v1.Post("/test/create-session", testhelpers.Handler{DB: db}.CreateSession)
		v1.Group(func(public chi.Router) {
			public.Use(ratelimit.PublicMiddleware())
			public.Get("/workspaces/invite-preview", workspacesHandler.PreviewInvite)
		})
		mcpHandler := mcp.Handler{DB: db}
		v1.Route("/mcp", func(mcpRouter chi.Router) {
			mcpRouter.Options("/", mcpHandler.Options)
			mcpRouter.Group(func(protectedMCP chi.Router) {
				protectedMCP.Use(authMiddleware.Require)
				protectedMCP.Use(ratelimit.Middleware())
				protectedMCP.Use(demo.SideEffectGuard{DB: db}.Block)
				protectedMCP.Get("/", mcpHandler.Get)
				protectedMCP.Post("/", mcpHandler.Post)
			})
		})
		v1.Group(func(protected chi.Router) {
			protected.Use(authMiddleware.Require)
			protected.Use(ratelimit.Middleware())
			protected.Use(demo.SideEffectGuard{DB: db}.Block)
			protected.Post("/issues/{id}/comments", commentsHandler.CreateForIssue)
			protected.Post("/issues/{id}/reactions", commentsHandler.ToggleIssueReaction)
			protected.Delete("/issues/{id}/reactions", commentsHandler.DeleteIssueReaction)
			protected.Mount("/account", account.Handler{DB: db}.Routes())
			protected.Mount("/analytics", analytics.Handler{DB: db}.Routes())
			protected.Mount("/agent/runs", agentruns.Handler{DB: db}.Routes())
			protected.Mount("/attachments", attachments.Handler{DB: db}.Routes())
			protected.Patch("/comments/{id}", commentsHandler.Update)
			protected.Mount("/custom-emojis", emojis.Handler{DB: db}.Routes())
			protected.Mount("/document-folders", documentsHandler.FolderRoutes())
			protected.Mount("/document-settings", documentsHandler.SettingsRoutes())
			protected.Mount("/document-templates", documentsHandler.TemplateRoutes())
			protected.Delete("/comments/{id}", commentsHandler.Delete)
			protected.Post("/comments/{id}/reactions", commentsHandler.ToggleCommentReaction)
			protected.Mount("/integrations", integrationsHandler.Routes())
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
			protected.Post("/workspaces/accept-invite", workspacesHandler.AcceptInvite)
			protected.Mount("/workspaces", workspacesHandler.Routes())
			protected.Get("/sync/ws", syncapi.Handler{DB: db}.WebSocket)
		})
	})
}

func metricsAccessAllowed(r *stdhttp.Request) bool {
	if !strings.EqualFold(os.Getenv("EXPONENTIAL_API_ENVIRONMENT"), "production") &&
		!strings.EqualFold(os.Getenv("NODE_ENV"), "production") {
		return true
	}
	token := strings.TrimSpace(os.Getenv("EXPONENTIAL_METRICS_TOKEN"))
	if token == "" {
		return false
	}
	supplied := strings.TrimSpace(r.Header.Get("X-Metrics-Token"))
	if supplied == "" {
		auth := strings.Fields(r.Header.Get("Authorization"))
		if len(auth) == 2 && strings.EqualFold(auth[0], "Bearer") {
			supplied = auth[1]
		}
	}
	return subtle.ConstantTimeCompare([]byte(supplied), []byte(token)) == 1
}

func limitRequestBody(maxBytes int64) func(stdhttp.Handler) stdhttp.Handler {
	return func(next stdhttp.Handler) stdhttp.Handler {
		return stdhttp.HandlerFunc(func(w stdhttp.ResponseWriter, r *stdhttp.Request) {
			if r.Body != nil && maxBytes > 0 {
				r.Body = stdhttp.MaxBytesReader(w, r.Body, maxBytes)
			}
			next.ServeHTTP(w, r)
		})
	}
}
