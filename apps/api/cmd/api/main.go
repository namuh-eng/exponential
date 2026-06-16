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
	"github.com/namuh-eng/exponential/apps/api/internal/integrations"
	"github.com/namuh-eng/exponential/apps/api/internal/logging"
	"github.com/namuh-eng/exponential/apps/api/internal/observability"
	"github.com/namuh-eng/exponential/apps/api/internal/webhooks"
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

	workerCtx, stopWorker := context.WithCancel(context.Background())
	defer stopWorker()
	go (integrations.SlackWorker{DB: db}).Start(workerCtx)
	go (integrations.MicrosoftTeamsWorker{DB: db}).Start(workerCtx)
	go (integrations.SentryWorker{DB: db}).Start(workerCtx)

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

	// Background webhook delivery processor — runs every 10 seconds.
	deliverer := &webhooks.Deliverer{DB: db}
	deliveryCtx, deliveryCancel := context.WithCancel(context.Background())
	defer deliveryCancel()
	go func() {
		ticker := time.NewTicker(10 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-deliveryCtx.Done():
				return
			case <-ticker.C:
				if err := deliverer.ProcessPending(deliveryCtx, 50); err != nil {
					logger.Warn("webhook delivery processing failed", zap.Error(err))
				}
			}
		}
	}()

	<-stop
	stopWorker()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil {
		logger.Fatal("api shutdown failed", zap.Error(err))
	}
}
