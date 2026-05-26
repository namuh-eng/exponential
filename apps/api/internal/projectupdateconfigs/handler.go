package projectupdateconfigs

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
)

type Handler struct{ DB *pgxpool.Pool }

type Configuration struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	Enabled      bool     `json:"enabled"`
	Cadence      string   `json:"cadence"`
	DayOfWeek    int      `json:"dayOfWeek"`
	TimeOfDay    string   `json:"timeOfDay"`
	Timezone     string   `json:"timezone"`
	ProjectScope string   `json:"projectScope"`
	StatusScope  []string `json:"statusScope"`
	ShareTargets []string `json:"shareTargets"`
	SlackChannel *string  `json:"slackChannel"`
	CreatedAt    string   `json:"createdAt"`
	UpdatedAt    string   `json:"updatedAt"`
}

type response struct {
	Configurations []Configuration `json:"configurations"`
	CanManage      bool            `json:"canManage"`
}

type configResponse struct {
	Configuration Configuration `json:"configuration"`
}

type access struct {
	Role     string
	Settings []byte
}

var timePattern = regexp.MustCompile(`^([01]\d|2[0-3]):[0-5]\d$`)

func (h Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Get("/", h.List)
	r.Post("/", h.Create)
	r.Patch("/{id}", h.Update)
	r.Delete("/{id}", h.Delete)
	return r
}

func (h Handler) List(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	access, ok := h.access(w, r, p)
	if !ok {
		return
	}
	problem.JSON(w, 200, response{Configurations: readConfigs(access.Settings), CanManage: canManage(access.Role)})
}

func (h Handler) Create(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	access, ok := h.access(w, r, p)
	if !ok {
		return
	}
	if !canManage(access.Role) {
		problem.Write(w, 403, "Only workspace admins can manage project updates", "")
		return
	}
	input, ok := readBody(w, r)
	if !ok {
		return
	}
	config, errMsg := validate(input, "")
	if errMsg != "" {
		problem.Write(w, 400, errMsg, "")
		return
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	config.CreatedAt = now
	config.UpdatedAt = now
	configs := append([]Configuration{config}, readConfigs(access.Settings)...)
	if !h.write(w, r, p.WorkspaceID, access.Settings, configs) {
		return
	}
	problem.JSON(w, 201, configResponse{Configuration: config})
}

func (h Handler) Update(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	access, ok := h.access(w, r, p)
	if !ok {
		return
	}
	if !canManage(access.Role) {
		problem.Write(w, 403, "Only workspace admins can manage project updates", "")
		return
	}
	input, ok := readBody(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")
	current := readConfigs(access.Settings)
	index := -1
	for i, c := range current {
		if c.ID == id {
			index = i
			break
		}
	}
	if index < 0 {
		problem.Write(w, 404, "Project update configuration not found", "")
		return
	}
	config, errMsg := validate(input, id)
	if errMsg != "" {
		problem.Write(w, 400, errMsg, "")
		return
	}
	config.CreatedAt = current[index].CreatedAt
	config.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	current[index] = config
	if !h.write(w, r, p.WorkspaceID, access.Settings, current) {
		return
	}
	problem.JSON(w, 200, configResponse{Configuration: config})
}

func (h Handler) Delete(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	access, ok := h.access(w, r, p)
	if !ok {
		return
	}
	if !canManage(access.Role) {
		problem.Write(w, 403, "Only workspace admins can manage project updates", "")
		return
	}
	id := chi.URLParam(r, "id")
	current := readConfigs(access.Settings)
	next := []Configuration{}
	found := false
	for _, c := range current {
		if c.ID == id {
			found = true
			continue
		}
		next = append(next, c)
	}
	if !found {
		problem.Write(w, 404, "Project update configuration not found", "")
		return
	}
	if !h.write(w, r, p.WorkspaceID, access.Settings, next) {
		return
	}
	problem.JSON(w, 200, map[string]bool{"success": true})
}

func (h Handler) access(w http.ResponseWriter, r *http.Request, p auth.Principal) (access, bool) {
	var a access
	err := h.DB.QueryRow(r.Context(), `select m.role::text, coalesce(w.settings,'{}'::jsonb) from workspace w join member m on m.workspace_id=w.id and m.user_id=$2 where w.id=$1::uuid limit 1`, p.WorkspaceID, p.UserID).Scan(&a.Role, &a.Settings)
	if err != nil {
		problem.Write(w, 404, "No workspace", err.Error())
		return access{}, false
	}
	return a, true
}

func (h Handler) write(w http.ResponseWriter, r *http.Request, workspaceID string, settings []byte, configs []Configuration) bool {
	next := map[string]any{}
	_ = json.Unmarshal(settings, &next)
	next["projectUpdateConfigurations"] = configs
	body, _ := json.Marshal(next)
	if _, err := h.DB.Exec(r.Context(), `update workspace set settings=$1::jsonb, updated_at=now() where id=$2::uuid`, body, workspaceID); err != nil {
		problem.Write(w, 500, "Save project update configuration failed", err.Error())
		return false
	}
	return true
}

func readBody(w http.ResponseWriter, r *http.Request) (map[string]any, bool) {
	var input map[string]any
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		problem.Write(w, 400, "Invalid JSON", "")
		return nil, false
	}
	return input, true
}

func readConfigs(settings []byte) []Configuration {
	var root map[string]json.RawMessage
	_ = json.Unmarshal(settings, &root)
	var raw []map[string]any
	_ = json.Unmarshal(root["projectUpdateConfigurations"], &raw)
	configs := []Configuration{}
	for _, item := range raw {
		id, _ := item["id"].(string)
		config, errMsg := validate(item, id)
		if errMsg != "" {
			continue
		}
		config.CreatedAt = stringOrNow(item["createdAt"])
		config.UpdatedAt = stringOrNow(item["updatedAt"])
		configs = append(configs, config)
	}
	return configs
}

func validate(input map[string]any, existingID string) (Configuration, string) {
	name := strings.TrimSpace(stringValue(input["name"]))
	if name == "" {
		return Configuration{}, "Configuration name is required"
	}
	cadence := stringValue(input["cadence"])
	if !allowed(cadence, []string{"weekly", "biweekly", "monthly"}) {
		return Configuration{}, "Choose a valid reminder cadence"
	}
	day := int(numberValue(input["dayOfWeek"]))
	if day < 1 || day > 7 || float64(day) != numberValue(input["dayOfWeek"]) {
		return Configuration{}, "Choose a valid reminder day"
	}
	tod := stringValue(input["timeOfDay"])
	if !timePattern.MatchString(tod) {
		return Configuration{}, "Use a valid reminder time"
	}
	timezone := strings.TrimSpace(stringValue(input["timezone"]))
	if timezone == "" {
		timezone = "UTC"
	}
	projectScope := stringValue(input["projectScope"])
	if !allowed(projectScope, []string{"all", "active", "statuses"}) {
		return Configuration{}, "Choose a valid project scope"
	}
	statusScope := uniqueAllowed(input["statusScope"], []string{"planned", "started", "paused", "completed", "canceled"})
	if projectScope == "statuses" && len(statusScope) == 0 {
		return Configuration{}, "Select at least one project status for this scope"
	}
	shareTargets := uniqueAllowed(input["shareTargets"], []string{"workspace", "slack", "email"})
	if len(shareTargets) == 0 {
		return Configuration{}, "Select at least one reporting target"
	}
	var slack *string
	slackText := strings.TrimSpace(stringValue(input["slackChannel"]))
	if slackText != "" {
		slack = &slackText
	}
	if contains(shareTargets, "slack") && slack == nil {
		return Configuration{}, "Slack channel is required for Slack reports"
	}
	id := existingID
	if id == "" {
		id = newID()
	}
	enabled := true
	if v, ok := input["enabled"].(bool); ok {
		enabled = v
	}
	return Configuration{ID: id, Name: name, Enabled: enabled, Cadence: cadence, DayOfWeek: day, TimeOfDay: tod, Timezone: timezone, ProjectScope: projectScope, StatusScope: statusScope, ShareTargets: shareTargets, SlackChannel: slack}, ""
}

func canManage(role string) bool { return role == "owner" || role == "admin" }
func stringValue(v any) string   { s, _ := v.(string); return s }
func numberValue(v any) float64 {
	switch n := v.(type) {
	case float64:
		return n
	case int:
		return float64(n)
	default:
		return 0
	}
}
func allowed(value string, options []string) bool {
	for _, option := range options {
		if value == option {
			return true
		}
	}
	return false
}
func contains(values []string, value string) bool {
	for _, item := range values {
		if item == value {
			return true
		}
	}
	return false
}
func uniqueAllowed(value any, options []string) []string {
	list, ok := value.([]any)
	if !ok {
		return []string{}
	}
	seen := map[string]bool{}
	result := []string{}
	for _, item := range list {
		s := stringValue(item)
		if allowed(s, options) && !seen[s] {
			seen[s] = true
			result = append(result, s)
		}
	}
	return result
}
func stringOrNow(value any) string {
	if s := stringValue(value); s != "" {
		return s
	}
	return time.Now().UTC().Format(time.RFC3339Nano)
}

func newID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "project-update-config"
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	s := hex.EncodeToString(b)
	return s[0:8] + "-" + s[8:12] + "-" + s[12:16] + "-" + s[16:20] + "-" + s[20:32]
}
