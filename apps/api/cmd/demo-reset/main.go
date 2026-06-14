package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/namuh-eng/exponential/apps/api/internal/config"
	"github.com/namuh-eng/exponential/apps/api/internal/database"
	"github.com/namuh-eng/exponential/apps/api/internal/demo"
)

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	cfg := config.Load()
	db, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		fmt.Fprintf(os.Stderr, "demo reset failed: %v\n", err)
		os.Exit(1)
	}
	defer db.Close()

	workspace, defaultTeam, err := demo.Reset(ctx, db)
	if err != nil {
		fmt.Fprintf(os.Stderr, "demo reset failed: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("demo reset complete: workspace=%s slug=%s default_team=%s\n", workspace.ID, workspace.URLSlug, defaultTeam.Key)
}
