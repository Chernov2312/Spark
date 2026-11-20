package signaling

import (
	"encoding/json"
	"net/http"
	"net/url"

	"github.com/gorilla/websocket"

	"spark/calls/internal/config"
	"spark/calls/internal/sparkapi"
)

type server struct {
	cfg      config.Config
	python   sparkapi.Client
	hub      *hub
	upgrader websocket.Upgrader
}

func newServer(cfg config.Config) *server {
	app := &server{
		cfg: cfg, python: sparkapi.New(cfg.PythonAPIURL), hub: newHub(cfg.ICEServers),
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
