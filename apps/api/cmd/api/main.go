package main

import (
	"context"
	"errors"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/namuh-eng/exponential/apps/api/internal/config"
	"github.com/namuh-eng/exponential/apps/api/internal/database"
	httpserver "github.com/namuh-eng/exponential/apps/api/internal/http"
	"github.com/namuh-eng/exponential/apps/api/internal/logging"
	"github.com/namuh-eng/exponential/apps/api/internal/observability"
	"go.uber.org/zap"
)

func main() {
	cfg := config.Load()
	logger, err := logging.New(cfg.Environment)
	if err != nil {
		panic(err)
	}
	defer func() { _ = logger.Sync() }()

	shutdownTracing, err := observability.ConfigureTracing(context.Background(), observability.TracingConfig{
		ServiceName:  cfg.ServiceName,
		Environment:  cfg.Environment,
		OTLPEndpoint: cfg.OTLPEndpoint,
	})
	if err != nil {
		logger.Fatal("configure tracing failed", zap.Error(err))
	}
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := shutdownTracing(ctx); err != nil {
			logger.Error("shutdown tracing failed", zap.Error(err))
		}
	}()

	db, err := database.Open(context.Background(), cfg.DatabaseURL)
	if err != nil {
		logger.Fatal("database connection failed", zap.Error(err))
	}
	defer db.Close()

	server := &http.Server{
		Addr:              cfg.Addr,
		Handler:           httpserver.NewRouter(logger, db),
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		logger.Info("api listening", zap.String("addr", cfg.Addr))
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Fatal("api server failed", zap.Error(err))
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil {
		logger.Fatal("api shutdown failed", zap.Error(err))
	}
}
