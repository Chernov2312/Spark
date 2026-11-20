package config

import (
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
	"time"
)

type Config struct {
	Address        string
	PythonAPIURL   string
	FrontendURL    string
	AllowedOrigins map[string]bool
	STUNURLs       []string
	turnURLs       []string
	turnSecret     string
}

type ICEServer struct {
	URLs       []string `json:"urls"`
	Username   string   `json:"username,omitempty"`
	Credential string   `json:"credential,omitempty"`
}

func getenv(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}

func listEnv(name, fallback string) []string {
	var values []string
	for _, value := range strings.Split(getenv(name, fallback), ",") {
		if value = strings.TrimSpace(value); value != "" {
			values = append(values, value)
		}
	}
	return values
}

func Load() (Config, error) {
	cfg := Config{
		Address:        getenv("CALLS_LISTEN_ADDR", ":8002"),
		PythonAPIURL:   strings.TrimRight(getenv("CALLS_PYTHON_API_URL", "http://127.0.0.1:8001/api/v1"), "/"),
		FrontendURL:    strings.TrimRight(getenv("FRONTEND_BASE_URL", "http://localhost:5174"), "/"),
		AllowedOrigins: make(map[string]bool),
		STUNURLs:       listEnv("CALLS_STUN_URLS", "stun:stun.l.google.com:19302"),
		turnURLs:       listEnv("CALLS_TURN_URLS", ""),
		turnSecret:     os.Getenv("CALLS_TURN_SECRET"),
	}
	for _, raw := range []string{cfg.PythonAPIURL, cfg.FrontendURL} {
		u, err := url.Parse(raw)
		if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
			return Config{}, errors.New("invalid Python API or frontend URL")
		}
	}
	for _, origin := range append([]string{cfg.FrontendURL}, listEnv("CALLS_ALLOWED_ORIGINS", "")...) {
		u, err := url.Parse(strings.TrimRight(origin, "/"))
		if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" {
			return Config{}, errors.New("invalid origin in CALLS_ALLOWED_ORIGINS")
		}
		cfg.AllowedOrigins[u.Scheme+"://"+u.Host] = true
	}
	if len(cfg.turnURLs) > 0 && cfg.turnSecret == "" {
		return Config{}, errors.New("CALLS_TURN_SECRET is required when TURN is configured")
	}
	return cfg, nil
}

func (cfg Config) ICEServers(peerID string) []ICEServer {
	servers := make([]ICEServer, 0, 2)
	if len(cfg.STUNURLs) > 0 {
		servers = append(servers, ICEServer{URLs: cfg.STUNURLs})
	}
	if len(cfg.turnURLs) > 0 {
		username := fmt.Sprintf("%d:%s", time.Now().Add(4*time.Hour).Unix(), peerID)
		signature := hmac.New(sha1.New, []byte(cfg.turnSecret))
		signature.Write([]byte(username))
		servers = append(servers, ICEServer{
			URLs: cfg.turnURLs, Username: username,
			Credential: base64.StdEncoding.EncodeToString(signature.Sum(nil)),
		})
	}
	return servers
}
