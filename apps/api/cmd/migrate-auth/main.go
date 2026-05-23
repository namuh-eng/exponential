package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/namuh-eng/exponential/apps/api/internal/config"
)

type userRow struct {
	ID            string
	Email         string
	Name          string
	EmailVerified bool
}

type kratosIdentityRequest struct {
	SchemaID string         `json:"schema_id"`
	Traits   map[string]any `json:"traits"`
}

func main() {
	ctx := context.Background()
	cfg := config.Load()
	adminURL := getenv("KRATOS_ADMIN_URL", "http://localhost:4434")
	if err := migrate(ctx, cfg.DatabaseURL, adminURL); err != nil {
		fmt.Fprintf(os.Stderr, "migrate auth failed: %v\n", err)
		os.Exit(1)
	}
}

func migrate(ctx context.Context, databaseURL string, kratosAdminURL string) error {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()

	rows, err := pool.Query(ctx, `select id, email, name, email_verified from "user" order by created_at asc`)
	if err != nil {
		return err
	}
	defer rows.Close()

	client := &http.Client{Timeout: 10 * time.Second}
	for rows.Next() {
		var user userRow
		if err := rows.Scan(&user.ID, &user.Email, &user.Name, &user.EmailVerified); err != nil {
			return err
		}
		if err := upsertIdentity(ctx, client, kratosAdminURL, user); err != nil {
			return fmt.Errorf("%s: %w", user.Email, err)
		}
	}
	return rows.Err()
}

func upsertIdentity(ctx context.Context, client *http.Client, adminURL string, user userRow) error {
	// Idempotency: first search by email. If Kratos already has the identity, leave it untouched.
	searchURL := fmt.Sprintf("%s/admin/identities?credentials_identifier=%s", adminURL, user.Email)
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, searchURL, nil)
	if err != nil {
		return err
	}
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode >= 200 && response.StatusCode < 300 {
		var identities []map[string]any
		if err := json.NewDecoder(response.Body).Decode(&identities); err == nil && len(identities) > 0 {
			return nil
		}
	}

	body, err := json.Marshal(kratosIdentityRequest{
		SchemaID: "default",
		Traits: map[string]any{
			"email":          user.Email,
			"name":           user.Name,
			"legacy_user_id": user.ID,
			"email_verified": user.EmailVerified,
		},
	})
	if err != nil {
		return err
	}
	createRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, adminURL+"/admin/identities", bytes.NewReader(body))
	if err != nil {
		return err
	}
	createRequest.Header.Set("Content-Type", "application/json")
	createResponse, err := client.Do(createRequest)
	if err != nil {
		return err
	}
	defer createResponse.Body.Close()
	if createResponse.StatusCode < 200 || createResponse.StatusCode >= 300 {
		return fmt.Errorf("kratos returned status %d", createResponse.StatusCode)
	}
	return nil
}

func getenv(key string, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	return value
}
