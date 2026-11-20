package signaling

import (
	"context"
	"net"
	"testing"

	"spark/calls/internal/config"
)

func TestRunStopsOnCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if err := Run(ctx, config.Config{Address: "127.0.0.1:0"}); err != nil {
		t.Fatalf("shutdown returned %v", err)
	}
}

func TestRunReturnsListenError(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = listener.Close() })
	if err := Run(t.Context(), config.Config{Address: listener.Addr().String()}); err == nil {
		t.Fatal("expected a listen error for an occupied address")
	}
}
