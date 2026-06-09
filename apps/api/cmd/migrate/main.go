package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/namuh-eng/exponential/apps/api/internal/config"
)

const migrationTable = "exponential_schema_migration"

func main() {
	ctx := context.Background()
	cfg := config.Load()
	migrationsDir := getenv("MIGRATIONS_DIR", "packages/proto/migrations")
	if err := migrate(ctx, cfg.DatabaseURL, migrationsDir); err != nil {
		fmt.Fprintf(os.Stderr, "migrate failed: %v\n", err)
		os.Exit(1)
	}
}

func migrate(ctx context.Context, databaseURL string, migrationsDir string) error {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()

	if _, err := pool.Exec(ctx, `
		create table if not exists `+migrationTable+` (
			version text primary key,
			applied_at timestamp not null default now()
		)`); err != nil {
		return err
	}

	files, err := filepath.Glob(filepath.Join(migrationsDir, "*.sql"))
	if err != nil {
		return err
	}
	sort.Strings(files)
	for _, file := range files {
		version := filepath.Base(file)
		var alreadyApplied bool
		if err := pool.QueryRow(ctx, `select exists(select 1 from `+migrationTable+` where version = $1)`, version).Scan(&alreadyApplied); err != nil {
			return err
		}
		if alreadyApplied {
			continue
		}
		body, err := os.ReadFile(file)
		if err != nil {
			return err
		}
		if strings.TrimSpace(string(body)) == "" {
			continue
		}
		tx, err := pool.Begin(ctx)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, string(body)); err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("%s: %w", version, err)
		}
		if _, err := tx.Exec(ctx, `insert into `+migrationTable+` (version) values ($1)`, version); err != nil {
			_ = tx.Rollback(ctx)
			return err
		}
		if err := tx.Commit(ctx); err != nil {
			return err
		}
		fmt.Printf("applied %s\n", version)
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
