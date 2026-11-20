package signaling

import (
	"context"
	"errors"
	"log"
	"net/http"
	"time"

	"spark/calls/internal/config"
)

// Run serves calls until the context is cancelled or the listener fails.
func Run(ctx context.Context, cfg config.Config) error {
	app := newServer(cfg)
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	go app.hub.expire(ctx)

	server := &http.Server{
		Addr: cfg.Address, Handler: app.routes(),
		ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second,
		WriteTimeout: 10 * time.Second, IdleTimeout: 60 * time.Second,
	}
	stopped := make(chan struct{})
	go func() {
		defer close(stopped)
		<-ctx.Done()
		shutdown, stop := context.WithTimeout(context.Background(), 5*time.Second)
		defer stop()
		_ = server.Shutdown(shutdown)
		app.hub.close()
	}()
	log.Printf("Spark calls listening on %s", cfg.Address)
	err := server.ListenAndServe()
	cancel()
	<-stopped
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}
