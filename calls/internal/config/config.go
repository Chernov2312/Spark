package config

import (
	"errors"
	"net/url"
	"os"
	"strings"
)

type Config struct {
	Address        string
	PythonAPIURL   string
	FrontendURL    string
	AllowedOrigins map[string]bool
	LiveKitURL     *url.URL
	LiveKitAPIKey  string
	LiveKitSecret  string
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
		LiveKitAPIKey:  strings.TrimSpace(os.Getenv("LIVEKIT_API_KEY")),
		LiveKitSecret:  strings.TrimSpace(os.Getenv("LIVEKIT_API_SECRET")),
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
	liveKitURL, err := url.Parse(strings.TrimRight(getenv("LIVEKIT_INTERNAL_URL", "http://127.0.0.1:7880"), "/"))
	if err != nil || liveKitURL.Hostname() == "" || (liveKitURL.Scheme != "http" && liveKitURL.Scheme != "https") ||
		liveKitURL.User != nil || liveKitURL.RawQuery != "" || liveKitURL.Fragment != "" || liveKitURL.Path != "" {
		return Config{}, errors.New("LIVEKIT_INTERNAL_URL must be an HTTP(S) origin")
	}
	if cfg.LiveKitAPIKey == "" || len(cfg.LiveKitSecret) < 32 {
		return Config{}, errors.New("LIVEKIT_API_KEY and a LIVEKIT_API_SECRET of at least 32 bytes are required")
	}
	cfg.LiveKitURL = liveKitURL
	return cfg, nil
}
