package signaling

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"

	"github.com/gorilla/websocket"

	"spark/calls/internal/config"
	"spark/calls/internal/livekit"
	"spark/calls/internal/sparkapi"
)

type server struct {
	cfg      config.Config
	python   sparkapi.Client
	hub      *hub
	media    *httputil.ReverseProxy
	upgrader websocket.Upgrader
}

func newServer(cfg config.Config) *server {
	app := &server{
		cfg: cfg, python: sparkapi.New(cfg.PythonAPIURL),
		hub: newHub(livekit.New(cfg.LiveKitURL, cfg.LiveKitAPIKey, cfg.LiveKitSecret)),
	}
	if cfg.LiveKitURL != nil {
		app.media = &httputil.ReverseProxy{Rewrite: func(request *httputil.ProxyRequest) {
			request.SetURL(cfg.LiveKitURL)
			request.Out.URL.Path = strings.TrimPrefix(request.In.URL.Path, "/v1/calls/media")
			request.Out.URL.RawPath = ""
			request.Out.Header.Del("Authorization")
			request.SetXForwarded()
		}}
	}
	app.upgrader = websocket.Upgrader{HandshakeTimeout: authTimeout, CheckOrigin: app.originAllowed}
	return app
}

func (s *server) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, fields{"status": "ok"})
	})
	mux.HandleFunc("GET /v1/calls/ws", s.websocket)
	mux.HandleFunc("GET /v1/calls/media/{route...}", s.serveMedia)
	mux.HandleFunc("POST /v1/calls/{call_id}/invites", s.createInvite)
	mux.HandleFunc("DELETE /v1/calls/invites/{invite_id}", s.revokeInvite)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if origin := r.Header.Get("Origin"); origin != "" {
			if !s.originAllowed(r) {
				writeJSON(w, http.StatusForbidden, fields{"code": denied.code, "message": denied.message})
				return
			}
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Add("Vary", "Origin")
			if r.Method == http.MethodOptions {
				w.Header().Set("Access-Control-Allow-Methods", "POST, DELETE, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
				w.WriteHeader(http.StatusNoContent)
				return
			}
		}
		mux.ServeHTTP(w, r)
	})
}

func (s *server) serveMedia(w http.ResponseWriter, r *http.Request) {
	switch r.PathValue("route") {
	case "rtc", "rtc/v1", "rtc/validate", "rtc/v1/validate":
	default:
		http.NotFound(w, r)
		return
	}
	if s.media == nil {
		http.Error(w, "media service unavailable", http.StatusServiceUnavailable)
		return
	}
	tokens := r.URL.Query()["access_token"]
	if len(tokens) != 1 {
		http.Error(w, "missing media token", http.StatusUnauthorized)
		return
	}
	room, peer, ok := s.hub.media.JoinIdentity(tokens[0])
	if !ok {
		http.Error(w, "invalid media token", http.StatusUnauthorized)
		return
	}
	session := s.hub.mediaSession(room, peer)
	if session == nil {
		http.Error(w, "call membership ended", http.StatusForbidden)
		return
	}
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	stop := context.AfterFunc(session, cancel)
	defer stop()
	s.media.ServeHTTP(w, r.WithContext(ctx))
}

func (s *server) originAllowed(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" || s.cfg.AllowedOrigins[origin] {
		return true
	}
	u, err := url.Parse(origin)
	return err == nil && (u.Scheme == "http" || u.Scheme == "https") &&
		u.Host == r.Host && u.User == nil && u.Path == "" && u.RawQuery == "" && u.Fragment == ""
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}
