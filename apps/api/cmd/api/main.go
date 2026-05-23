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
	httpserver "github.com/namuh-eng/exponential/apps/api/internal/http"
	"github.com/namuh-eng/exponential/apps/api/internal/logging"
	"go.uber.org/zap"
)

func main() {
	cfg := config.Load()
	logger, err := logging.New(cfg.Environment)
	if err != nil {
		panic(err)
	}
	defer func() { _ = logger.Sync() }()

	server := &http.Server{
		Addr:              cfg.Addr,
		Handler:           httpserver.NewRouter(logger),
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
