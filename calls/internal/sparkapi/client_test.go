package sparkapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPythonAPIRequiresValidIdentityAndMembership(t *testing.T) {
	const (
		ownerID  = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa"
		memberID = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb"
		chatID   = "dddddddd-dddd-4ddd-dddd-dddddddddddd"
	)
	python := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/users/me":
			if r.Header.Get("Authorization") == "Bearer redirect" {
				http.Redirect(w, r, "/redirected", http.StatusFound)
				return
			}
			_ = json.NewEncoder(w).Encode(Person{ID: "invalid"})
		case "/chats/" + chatID + "/members":
			_ = json.NewEncoder(w).Encode([]Person{{ID: ownerID}})
		case "/redirected":
			t.Error("Python API redirect was followed")
			_ = json.NewEncoder(w).Encode(Person{ID: memberID})
		default:
			t.Errorf("unexpected request to Python API: %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(python.Close)
	api := New(python.URL)
	if _, err := api.Identity(t.Context(), "member"); !errors.Is(err, ErrDenied) {
		t.Fatalf("invalid identity error = %v, want access denied", err)
	}
	if _, _, err := api.Members(t.Context(), chatID, "member", memberID); !errors.Is(err, ErrDenied) {
		t.Fatalf("missing membership error = %v, want access denied", err)
	}
	if _, err := api.Identity(t.Context(), "redirect"); err == nil || errors.Is(err, ErrDenied) {
		t.Fatalf("redirect error = %v, want unavailable", err)
	}
}
