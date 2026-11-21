package config

import (
	"strings"
	"testing"
)

func TestLoadConfigRejectsInvalidValues(t *testing.T) {
	t.Setenv("FRONTEND_BASE_URL", "https://spark.example")
	t.Setenv("CALLS_ALLOWED_ORIGINS", "")
	t.Setenv("CALLS_PYTHON_API_URL", "http://backend:8000/api/v1")
	t.Setenv("LIVEKIT_API_KEY", "test-key")
	t.Setenv("LIVEKIT_API_SECRET", strings.Repeat("s", 32))
	for _, tt := range []struct {
		name, key, value, want string
	}{
		{"Python API scheme", "CALLS_PYTHON_API_URL", "file:///api/v1", "invalid Python API"},
		{"frontend URL query", "FRONTEND_BASE_URL", "https://spark.example?foo=bar", "invalid Python API or frontend URL"},
		{"origin path", "CALLS_ALLOWED_ORIGINS", "https://staging.spark.example/chats", "invalid origin"},
		{"LiveKit WebSocket URL", "LIVEKIT_INTERNAL_URL", "ws://livekit:7880", "HTTP(S) origin"},
		{"LiveKit URL path", "LIVEKIT_INTERNAL_URL", "http://livekit:7880/path", "HTTP(S) origin"},
		{"missing LiveKit key", "LIVEKIT_API_KEY", "", "LIVEKIT_API_KEY"},
		{"short LiveKit secret", "LIVEKIT_API_SECRET", "bad", "at least 32 bytes"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv(tt.key, tt.value)
			if _, err := Load(); err == nil || !strings.Contains(err.Error(), tt.want) {
				t.Fatalf("Load error = %v, want %q", err, tt.want)
			}
		})
	}
}

func TestLoadLiveKitConfig(t *testing.T) {
	t.Setenv("FRONTEND_BASE_URL", "http://localhost:5174")
	t.Setenv("LIVEKIT_INTERNAL_URL", "http://livekit:7880/")
	t.Setenv("LIVEKIT_API_KEY", "test-key")
	t.Setenv("LIVEKIT_API_SECRET", strings.Repeat("s", 32))
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.LiveKitURL.String() != "http://livekit:7880" || cfg.LiveKitAPIKey != "test-key" {
		t.Fatal("unexpected LiveKit configuration")
	}
}
