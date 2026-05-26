package projectupdates

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/namuh-eng/exponential/apps/api/internal/auth"
	"github.com/namuh-eng/exponential/apps/api/internal/problem"
)

type Handler struct{ DB *pgxpool.Pool }

type Configuration struct {
	ID              string   `json:"id"`
	Name            string   `json:"name"`
	Enabled         bool     `json:"enabled"`
	Cadence         string   `json:"cadence"`
	DueDay          string   `json:"dueDay"`
	DueTime         string   `json:"dueTime"`
	Timezone        string   `json:"timezone"`
	Scope           string   `json:"scope"`
	ProjectIDs      []string `json:"projectIds"`
	ReportingTarget string   `json:"reportingTarget"`
	ShareTarget     string   `json:"shareTarget"`
	CreatedAt       string   `json:"createdAt"`
	UpdatedAt       string   `json:"updatedAt"`
}

type listResponse struct {
	Configurations []Configuration `json:"configurations"`
}
type itemResponse struct {
	Configuration Configuration `json:"configuration"`
}
type validation struct {
	OK    bool
	Value map[string]any
	Error string
	Field string
}

var dueTimePattern = regexp.MustCompile(`^(?:[01]\d|2[0-3]):[0-5]\d$`)
var timezonePattern = regexp.MustCompile(`^[A-Za-z0-9_+\-/]+$`)

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
	settings, ok := h.settings(w, r, p.WorkspaceID)
	if !ok {
		return
	}
	problem.JSON(w, 200, listResponse{Configurations: readConfigurations(settings)})
}

func (h Handler) Create(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	input, ok := readBody(w, r)
	if !ok {
		return
	}
	v := validateInput(input, false)
	if !v.OK {
		writeValidation(w, v)
		return
	}
	settings, ok := h.settings(w, r, p.WorkspaceID)
	if !ok {
		return
	}
	configs := readConfigurations(settings)
	config := buildConfiguration(v.Value, time.Now())
	configs = append(configs, config)
	if !h.write(w, r, p.WorkspaceID, settings, configs) {
		return
	}
	problem.JSON(w, 201, itemResponse{Configuration: config})
}

func (h Handler) Update(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	input, ok := readBody(w, r)
	if !ok {
		return
	}
	v := validateInput(input, true)
	if !v.OK {
		writeValidation(w, v)
		return
	}
	settings, ok := h.settings(w, r, p.WorkspaceID)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")
	configs := readConfigurations(settings)
	index := -1
	for i, c := range configs {
		if c.ID == id {
			index = i
			break
		}
	}
	if index < 0 {
		problem.Write(w, 404, "Project update configuration not found", "")
		return
	}
	configs[index] = updateConfiguration(configs[index], v.Value, time.Now())
	if !h.write(w, r, p.WorkspaceID, settings, configs) {
		return
	}
	problem.JSON(w, 200, itemResponse{Configuration: configs[index]})
}

func (h Handler) Delete(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	settings, ok := h.settings(w, r, p.WorkspaceID)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")
	configs := readConfigurations(settings)
	next := []Configuration{}
	found := false
	for _, c := range configs {
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
	if !h.write(w, r, p.WorkspaceID, settings, next) {
		return
	}
	problem.JSON(w, 200, map[string]bool{"success": true})
}

func (h Handler) settings(w http.ResponseWriter, r *http.Request, workspaceID string) ([]byte, bool) {
	var settings []byte
	if err := h.DB.QueryRow(r.Context(), `select coalesce(settings,'{}'::jsonb) from workspace where id=$1::uuid limit 1`, workspaceID).Scan(&settings); err != nil {
		problem.Write(w, 404, "No workspace", err.Error())
		return nil, false
	}
	return settings, true
}
func (h Handler) write(w http.ResponseWriter, r *http.Request, workspaceID string, settings []byte, configs []Configuration) bool {
	root := map[string]any{}
	_ = json.Unmarshal(settings, &root)
	root["projectUpdateConfigurations"] = configs
	body, _ := json.Marshal(root)
	if _, err := h.DB.Exec(r.Context(), `update workspace set settings=$1::jsonb, updated_at=now() where id=$2::uuid`, body, workspaceID); err != nil {
		problem.Write(w, 500, "Save project update settings failed", err.Error())
		return false
	}
	return true
}
func readBody(w http.ResponseWriter, r *http.Request) (map[string]any, bool) {
	var input map[string]any
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		problem.JSON(w, 400, map[string]string{"error": "Invalid JSON"})
		return nil, false
	}
	return input, true
}
func writeValidation(w http.ResponseWriter, v validation) {
	payload := map[string]string{"error": v.Error}
	if v.Field != "" {
		payload["field"] = v.Field
	}
	problem.JSON(w, 400, payload)
}

func readConfigurations(settings []byte) []Configuration {
	root := map[string]json.RawMessage{}
	_ = json.Unmarshal(settings, &root)
	var raw []map[string]any
	_ = json.Unmarshal(root["projectUpdateConfigurations"], &raw)
	configs := []Configuration{}
	for _, item := range raw {
		c := normalizeStored(item)
		if c.ID != "" {
			configs = append(configs, c)
		}
	}
	sort.Slice(configs, func(i, j int) bool { return configs[i].CreatedAt < configs[j].CreatedAt })
	return configs
}
func normalizeStored(item map[string]any) Configuration {
	id := strings.TrimSpace(stringValue(item["id"]))
	if id == "" {
		return Configuration{}
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	name := strings.TrimSpace(stringValue(item["name"]))
	if name == "" {
		name = "Project update reminder"
	}
	return Configuration{ID: id, Name: name, Enabled: boolDefault(item["enabled"], true), Cadence: stringOption(item["cadence"], []string{"weekly", "biweekly", "monthly"}, "weekly"), DueDay: stringOption(item["dueDay"], []string{"monday", "tuesday", "wednesday", "thursday", "friday"}, "friday"), DueTime: dueTimeDefault(item["dueTime"]), Timezone: timezoneDefault(item["timezone"]), Scope: stringOption(item["scope"], []string{"all_projects", "active_projects", "selected_projects"}, "active_projects"), ProjectIDs: normalizeProjectIDs(item["projectIds"]), ReportingTarget: stringOption(item["reportingTarget"], []string{"workspace", "slack", "email"}, "workspace"), ShareTarget: stringValue(item["shareTarget"]), CreatedAt: stringDefault(item["createdAt"], now), UpdatedAt: stringDefault(item["updatedAt"], now)}
}

func validateInput(input map[string]any, partial bool) validation {
	value := map[string]any{}
	if _, has := input["name"]; has || !partial {
		name := strings.TrimSpace(stringValue(input["name"]))
		if name == "" {
			return validation{Error: "Name is required", Field: "name"}
		}
		if len(name) > 120 {
			return validation{Error: "Name must be 120 characters or fewer", Field: "name"}
		}
		value["name"] = name
	}
	if _, has := input["enabled"]; has || !partial {
		value["enabled"] = boolDefault(input["enabled"], true)
	}
	if _, has := input["cadence"]; has || !partial {
		if !allowed(stringValue(input["cadence"]), []string{"weekly", "biweekly", "monthly"}) {
			return validation{Error: "Cadence is invalid", Field: "cadence"}
		}
		value["cadence"] = stringValue(input["cadence"])
	}
	if _, has := input["dueDay"]; has || !partial {
		if !allowed(stringValue(input["dueDay"]), []string{"monday", "tuesday", "wednesday", "thursday", "friday"}) {
			return validation{Error: "Due day is invalid", Field: "dueDay"}
		}
		value["dueDay"] = stringValue(input["dueDay"])
	}
	if _, has := input["dueTime"]; has || !partial {
		if !dueTimePattern.MatchString(stringValue(input["dueTime"])) {
			return validation{Error: "Due time must use 24-hour HH:MM format", Field: "dueTime"}
		}
		value["dueTime"] = stringValue(input["dueTime"])
	}
	if _, has := input["timezone"]; has || !partial {
		if !isTimezone(input["timezone"]) {
			return validation{Error: "Timezone is invalid", Field: "timezone"}
		}
		value["timezone"] = stringValue(input["timezone"])
	}
	if _, has := input["scope"]; has || !partial {
		if !allowed(stringValue(input["scope"]), []string{"all_projects", "active_projects", "selected_projects"}) {
			return validation{Error: "Scope is invalid", Field: "scope"}
		}
		value["scope"] = stringValue(input["scope"])
	}
	if _, has := input["projectIds"]; has {
		value["projectIds"] = normalizeProjectIDs(input["projectIds"])
	} else if !partial {
		value["projectIds"] = []string{}
	}
	if _, has := input["reportingTarget"]; has || !partial {
		if !allowed(stringValue(input["reportingTarget"]), []string{"workspace", "slack", "email"}) {
			return validation{Error: "Reporting target is invalid", Field: "reportingTarget"}
		}
		value["reportingTarget"] = stringValue(input["reportingTarget"])
	}
	if _, has := input["shareTarget"]; has || !partial {
		share := strings.TrimSpace(stringValue(input["shareTarget"]))
		if len(share) > 160 {
			return validation{Error: "Share target must be 160 characters or fewer", Field: "shareTarget"}
		}
		value["shareTarget"] = share
	}
	return validation{OK: true, Value: value}
}

func buildConfiguration(input map[string]any, now time.Time) Configuration {
	ts := now.UTC().Format(time.RFC3339Nano)
	return Configuration{ID: newID(), Name: stringDefault(input["name"], "Project update reminder"), Enabled: boolDefault(input["enabled"], true), Cadence: stringDefault(input["cadence"], "weekly"), DueDay: stringDefault(input["dueDay"], "friday"), DueTime: stringDefault(input["dueTime"], "09:00"), Timezone: stringDefault(input["timezone"], "UTC"), Scope: stringDefault(input["scope"], "active_projects"), ProjectIDs: stringSlice(input["projectIds"]), ReportingTarget: stringDefault(input["reportingTarget"], "workspace"), ShareTarget: stringValue(input["shareTarget"]), CreatedAt: ts, UpdatedAt: ts}
}
func updateConfiguration(current Configuration, input map[string]any, now time.Time) Configuration {
	if v, ok := input["name"]; ok {
		current.Name = stringValue(v)
	}
	if v, ok := input["enabled"]; ok {
		current.Enabled = boolDefault(v, true)
	}
	if v, ok := input["cadence"]; ok {
		current.Cadence = stringValue(v)
	}
	if v, ok := input["dueDay"]; ok {
		current.DueDay = stringValue(v)
	}
	if v, ok := input["dueTime"]; ok {
		current.DueTime = stringValue(v)
	}
	if v, ok := input["timezone"]; ok {
		current.Timezone = stringValue(v)
	}
	if v, ok := input["scope"]; ok {
		current.Scope = stringValue(v)
	}
	if v, ok := input["projectIds"]; ok {
		current.ProjectIDs = stringSlice(v)
	}
	if v, ok := input["reportingTarget"]; ok {
		current.ReportingTarget = stringValue(v)
	}
	if v, ok := input["shareTarget"]; ok {
		current.ShareTarget = stringValue(v)
	}
	current.UpdatedAt = now.UTC().Format(time.RFC3339Nano)
	return current
}

func newID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "project-update"
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	s := hex.EncodeToString(b)
	return s[0:8] + "-" + s[8:12] + "-" + s[12:16] + "-" + s[16:20] + "-" + s[20:32]
}
func stringValue(v any) string { s, _ := v.(string); return s }
func stringDefault(v any, fallback string) string {
	if s := stringValue(v); s != "" {
		return s
	}
	return fallback
}
func boolDefault(v any, fallback bool) bool {
	if b, ok := v.(bool); ok {
		return b
	}
	return fallback
}
func allowed(v string, opts []string) bool {
	for _, opt := range opts {
		if v == opt {
			return true
		}
	}
	return false
}
func stringOption(v any, opts []string, fallback string) string {
	s := stringValue(v)
	if allowed(s, opts) {
		return s
	}
	return fallback
}
func dueTimeDefault(v any) string {
	s := stringValue(v)
	if dueTimePattern.MatchString(s) {
		return s
	}
	return "09:00"
}
func isTimezone(v any) bool {
	s := stringValue(v)
	return s != "" && len(s) <= 80 && timezonePattern.MatchString(s)
}
func timezoneDefault(v any) string {
	if isTimezone(v) {
		return stringValue(v)
	}
	return "UTC"
}
func normalizeProjectIDs(v any) []string {
	list, ok := v.([]any)
	if !ok {
		return []string{}
	}
	seen := map[string]bool{}
	result := []string{}
	for _, item := range list {
		s := strings.TrimSpace(stringValue(item))
		if s != "" && !seen[s] {
			seen[s] = true
			result = append(result, s)
		}
	}
	return result
}
func stringSlice(v any) []string {
	s, ok := v.([]string)
	if ok {
		return s
	}
	return normalizeProjectIDs(v)
}
