package config

import (
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestLoadConfigRejectsInvalidValues(t *testing.T) {
	t.Setenv("FRONTEND_BASE_URL", "https://spark.example")
	t.Setenv("CALLS_ALLOWED_ORIGINS", "")
	t.Setenv("CALLS_PYTHON_API_URL", "http://backend:8000/api/v1")
	t.Setenv("CALLS_TURN_URLS", "")
	t.Setenv("CALLS_TURN_SECRET", "")
	for _, tt := range []struct {
		name, key, value, want string
	}{
		{"Python API scheme", "CALLS_PYTHON_API_URL", "file:///api/v1", "invalid Python API"},
		{"frontend URL query", "FRONTEND_BASE_URL", "https://spark.example?foo=bar", "invalid Python API or frontend URL"},
		{"origin path", "CALLS_ALLOWED_ORIGINS", "https://staging.spark.example/chats", "invalid origin"},
		{"missing TURN secret", "CALLS_TURN_URLS", "turn:relay.example:3478", "CALLS_TURN_SECRET is required"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv(tt.key, tt.value)
			if _, err := Load(); err == nil || !strings.Contains(err.Error(), tt.want) {
				t.Fatalf("Load error = %v, want %q", err, tt.want)
			}
		})
	}
}

func TestICEServersSignsTemporaryTURNCredentials(t *testing.T) {
	const memberID = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb"
	const secret = "test-turn-secret"
	cfg := Config{
		STUNURLs:   []string{"stun:stun.example:3478"},
		turnURLs:   []string{"turn:relay.example:3478", "turns:relay.example:5349"},
		turnSecret: secret,
	}
	before := time.Now().Add(4 * time.Hour).Unix()
	servers := cfg.ICEServers(memberID)
	after := time.Now().Add(4 * time.Hour).Unix()
	if len(servers) != 2 {
		t.Fatalf("want a STUN and a TURN entry, got %v", servers)
	}
	stun, turn := servers[0], servers[1]
	if len(stun.URLs) != 1 || stun.URLs[0] != cfg.STUNURLs[0] || stun.Username != "" || stun.Credential != "" {
		t.Fatalf("unexpected STUN entry: %v", stun)
	}
	if len(turn.URLs) != 2 || turn.URLs[0] != cfg.turnURLs[0] || turn.URLs[1] != cfg.turnURLs[1] {
		t.Fatalf("unexpected TURN URLs: %v", turn.URLs)
	}
	expires, peerID, _ := strings.Cut(turn.Username, ":")
	expiry, err := strconv.ParseInt(expires, 10, 64)
	if err != nil || peerID != memberID || expiry < before || expiry > after {
		t.Fatalf("unexpected TURN username: %q", turn.Username)
	}
	signature := hmac.New(sha1.New, []byte(secret))
	if _, err := signature.Write([]byte(turn.Username)); err != nil {
		t.Fatal(err)
	}
	if want := base64.StdEncoding.EncodeToString(signature.Sum(nil)); turn.Credential != want {
		t.Fatal("TURN credential is not signed for the issued username")
	}
}
