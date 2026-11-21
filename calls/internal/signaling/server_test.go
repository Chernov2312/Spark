package signaling

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"spark/calls/internal/config"
	"spark/calls/internal/sparkapi"
)

const (
	ownerID    = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa"
	memberID   = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb"
	outsiderID = "cccccccc-cccc-4ccc-cccc-cccccccccccc"
	chatID     = "dddddddd-dddd-4ddd-dddd-dddddddddddd"
)

func TestConfiguredOrigins(t *testing.T) {
	t.Setenv("FRONTEND_BASE_URL", "https://spark.example")
	t.Setenv("CALLS_ALLOWED_ORIGINS", "https://test.spark.example, http://localhost:5174")
	t.Setenv("CALLS_TURN_URLS", "")
	cfg, err := config.Load()
	if err != nil {
		t.Fatal(err)
	}
	app := newServer(cfg)
	for origin, allowed := range map[string]bool{
		"https://spark.example":      true,
		"https://test.spark.example": true,
		"http://localhost:5174":      true,
		"https://other.example":      false,
	} {
		request := httptest.NewRequest(http.MethodGet, "http://calls:8002/v1/calls/ws", nil)
		request.Header.Set("Origin", origin)
		if app.originAllowed(request) != allowed {
			t.Errorf("origin %q allowed = %t, want %t", origin, !allowed, allowed)
		}
	}
}

func testServer(t *testing.T) *httptest.Server {
	t.Helper()
	users := map[string]sparkapi.Person{
		"Bearer owner":    {ID: ownerID, Username: "Владелец", Role: "owner"},
		"Bearer member":   {ID: memberID, Username: "Участник", Role: "member"},
		"Bearer outsider": {ID: outsiderID, Username: "Другой"},
	}
	users["Bearer owner-renewed"] = users["Bearer owner"]
	users["Bearer member-renewed"] = users["Bearer member"]
	python := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, ok := users[r.Header.Get("Authorization")]
		if !ok {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		switch r.URL.Path {
		case "/api/v1/users/me":
			writeJSON(w, http.StatusOK, user)
		case "/api/v1/chats/" + chatID + "/members":
			if user.Role == "" {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			writeJSON(w, http.StatusOK, []sparkapi.Person{users["Bearer owner"], users["Bearer member"]})
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(python.Close)
	app := newServer(config.Config{
		PythonAPIURL: python.URL + "/api/v1", FrontendURL: "https://spark.example",
		STUNURLs:       []string{"stun:stun.example:3478"},
		AllowedOrigins: map[string]bool{"https://spark.example": true},
	})
	service := httptest.NewServer(app.routes())
	t.Cleanup(service.Close)
	t.Cleanup(app.hub.close)
	return service
}

func dial(t *testing.T, service *httptest.Server, auth fields) *websocket.Conn {
	t.Helper()
	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(service.URL, "http")+"/v1/calls/ws", nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	send(t, conn, "auth", auth)
	return conn
}

func send(t *testing.T, conn *websocket.Conn, name string, data fields) {
	t.Helper()
	if err := conn.WriteJSON(event{name, data}); err != nil {
		t.Fatal(err)
	}
}

func receive(t *testing.T, conn *websocket.Conn, want string) fields {
	t.Helper()
	_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	var item event
	if err := conn.ReadJSON(&item); err != nil {
		t.Fatalf("receive %s: %v", want, err)
	}
	if item.Event != want {
		t.Fatalf("event = %s, want %s (%v)", item.Event, want, item.Data)
	}
	return item.Data
}

func start(t *testing.T, service *httptest.Server) (*websocket.Conn, string) {
	t.Helper()
	owner := dial(t, service, fields{"access_token": "owner"})
	receive(t, owner, "auth:ok")
	send(t, owner, "call:start", fields{"chat_id": chatID, "media": "video"})
	return owner, receive(t, owner, "call:started")["call_id"].(string)
}

func TestCallActionsAcceptRenewedTokensForSameUser(t *testing.T) {
	service := testServer(t)
	owner := dial(t, service, fields{"access_token": "owner"})
	member := dial(t, service, fields{"access_token": "member"})
	receive(t, owner, "auth:ok")
	receive(t, member, "auth:ok")

	send(t, owner, "call:start", fields{"chat_id": chatID, "media": "audio", "access_token": "member-renewed"})
	if problem := receive(t, owner, "call:error"); problem["code"] != "forbidden" {
		t.Fatalf("call start accepted an account change: %v", problem)
	}
	send(t, owner, "call:start", fields{"chat_id": chatID, "media": "audio", "access_token": "owner-renewed"})
	callID := receive(t, owner, "call:started")["call_id"]
	receive(t, member, "call:incoming")
	send(t, member, "call:accept", fields{"call_id": callID, "access_token": "member-renewed"})
	receive(t, member, "call:accepted")
}

func TestMemberCallRelaysSignalsAndDisconnects(t *testing.T) {
	service := testServer(t)
	member := dial(t, service, fields{"access_token": "member"})
	receive(t, member, "auth:ok")
	outsider := dial(t, service, fields{"access_token": "outsider"})
	receive(t, outsider, "auth:ok")
	send(t, outsider, "call:start", fields{"chat_id": chatID, "media": "audio"})
	receive(t, outsider, "call:error")

	owner, callID := start(t, service)
	incoming := receive(t, member, "call:incoming")
	if incoming["call_id"] != callID || incoming["media"] != "video" || incoming["caller_name"] != "Владелец" {
		t.Fatalf("unexpected invite: %v", incoming)
	}
	send(t, outsider, "call:accept", fields{"call_id": callID})
	receive(t, outsider, "call:error")
	send(t, member, "call:accept", fields{"call_id": callID})
	receive(t, member, "call:accepted")
	if peer := receive(t, member, "call:peer_joined"); peer["peer_id"] != ownerID || peer["should_offer"] != false {
		t.Fatalf("unexpected caller: %v", peer)
	}
	receive(t, owner, "call:accepted")
	if peer := receive(t, owner, "call:peer_joined"); peer["peer_id"] != memberID || peer["should_offer"] != true {
		t.Fatalf("unexpected participant: %v", peer)
	}

	send(t, owner, "rtc:offer", fields{"call_id": callID, "target_id": memberID, "sdp": fields{"type": "offer", "sdp": "example"}})
	if offer := receive(t, member, "rtc:offer"); offer["from_id"] != ownerID {
		t.Fatalf("unexpected offer sender: %v", offer)
	}
	send(t, member, "rtc:answer", fields{"call_id": callID, "target_id": ownerID, "sdp": fields{"type": "answer", "sdp": "example"}})
	receive(t, owner, "rtc:answer")
	send(t, member, "rtc:ice", fields{"call_id": callID, "target_id": ownerID, "candidate": fields{"candidate": "candidate:example"}})
	receive(t, owner, "rtc:ice")
	if err := member.Close(); err != nil {
		t.Fatal(err)
	}
	if left := receive(t, owner, "call:peer_left"); left["peer_id"] != memberID {
		t.Fatalf("unexpected disconnected participant: %v", left)
	}

	send(t, owner, "call:end", fields{"call_id": callID})
	receive(t, owner, "call:ended")
	_, nextID := start(t, service)
	if nextID == callID {
		t.Fatal("ended call ID was reused")
	}
}

func TestDeclineClearsIncomingCallOnEveryTab(t *testing.T) {
	service := testServer(t)
	member := dial(t, service, fields{"access_token": "member"})
	receive(t, member, "auth:ok")
	owner, callID := start(t, service)
	receive(t, member, "call:incoming")
	otherTab := dial(t, service, fields{"access_token": "member"})
	receive(t, otherTab, "auth:ok")
	if incoming := receive(t, otherTab, "call:incoming"); incoming["call_id"] != callID {
		t.Fatalf("new tab did not receive pending call: %v", incoming)
	}

	send(t, member, "call:start", fields{"chat_id": chatID, "media": "audio"})
	if problem := receive(t, member, "call:error"); problem["code"] != "busy" {
		t.Fatalf("expected busy while ringing: %v", problem)
	}
	send(t, member, "call:decline", fields{"call_id": callID})
	for _, tab := range []*websocket.Conn{member, otherTab} {
		if ended := receive(t, tab, "call:ended"); ended["call_id"] != callID {
			t.Fatalf("decline dismissed the wrong call: %v", ended)
		}
	}
	if declined := receive(t, owner, "call:declined"); declined["call_id"] != callID {
		t.Fatalf("caller received the wrong declined event: %v", declined)
	}
	send(t, otherTab, "call:accept", fields{"call_id": callID})
	if problem := receive(t, otherTab, "call:error"); problem["code"] != "forbidden" {
		t.Fatalf("a stale tab accepted a declined call: %v", problem)
	}
}

func TestSocketRejectsInvalidAuthenticationAndSignalling(t *testing.T) {
	service := testServer(t)
	for _, tt := range []struct {
		name, code  string
		credentials fields
	}{
		{"without token", "invalid_auth", fields{}},
		{"two tokens", "invalid_auth", fields{"access_token": "member", "invite_token": "guest"}},
		{"unknown token", "forbidden", fields{"access_token": "unknown"}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			conn := dial(t, service, tt.credentials)
			if problem := receive(t, conn, "auth:error"); problem["code"] != tt.code {
				t.Fatalf("unexpected auth error: %v", problem)
			}
		})
	}
	caller, callID := start(t, service)
	send(t, caller, "rtc:offer", fields{"call_id": callID, "target_id": memberID, "sdp": fields{"type": "answer", "sdp": "example"}})
	if problem := receive(t, caller, "call:error"); problem["code"] != "invalid_signal" {
		t.Fatalf("accepted the wrong SDP type: %v", problem)
	}
	send(t, caller, "rtc:ice", fields{"call_id": callID, "target_id": memberID, "candidate": fields{}})
	if problem := receive(t, caller, "call:error"); problem["code"] != "invalid_signal" {
		t.Fatalf("accepted an empty ICE candidate: %v", problem)
	}
	send(t, caller, "rtc:offer", fields{"call_id": callID, "target_id": outsiderID, "sdp": fields{"type": "offer", "sdp": "example"}})
	if problem := receive(t, caller, "call:error"); problem["code"] != "forbidden" {
		t.Fatalf("relayed SDP outside the call: %v", problem)
	}
}

func TestHTTPRoutesCheckOriginAndBearer(t *testing.T) {
	service := testServer(t)
	unauthorized := "/v1/calls/" + chatID + "/invites"
	for _, tt := range []struct {
		name, method, path, origin, auth, body string
		status                                 int
	}{
		{"health", http.MethodGet, "/health", "", "", `"status":"ok"`, http.StatusOK},
		{"allowed preflight", http.MethodOptions, unauthorized, "https://spark.example", "", "", http.StatusNoContent},
		{"denied preflight", http.MethodOptions, unauthorized, "https://other.example", "", `"code":"forbidden"`, http.StatusForbidden},
		{"missing bearer", http.MethodPost, unauthorized, "", "", `"code":"unauthorized"`, http.StatusUnauthorized},
		{"invalid bearer", http.MethodPost, unauthorized, "", "Bearer unknown", `"code":"forbidden"`, http.StatusUnauthorized},
		{"missing call", http.MethodPost, unauthorized, "", "Bearer owner", `"code":"call_unavailable"`, http.StatusNotFound},
		{"missing invite", http.MethodDelete, "/v1/calls/invites/unknown", "", "Bearer owner", `"code":"invite_invalid"`, http.StatusNotFound},
	} {
		t.Run(tt.name, func(t *testing.T) {
			request, err := http.NewRequestWithContext(t.Context(), tt.method, service.URL+tt.path, nil)
			if err != nil {
				t.Fatal(err)
			}
			request.Header.Set("Origin", tt.origin)
			request.Header.Set("Authorization", tt.auth)
			response, err := service.Client().Do(request)
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = response.Body.Close() }()
			body, err := io.ReadAll(response.Body)
			if err != nil {
				t.Fatal(err)
			}
			if response.StatusCode != tt.status || !strings.Contains(string(body), tt.body) {
				t.Fatalf("unexpected HTTP response %d: %s", response.StatusCode, body)
			}
			if tt.status == http.StatusNoContent && (response.Header.Get("Access-Control-Allow-Origin") != tt.origin || !strings.Contains(response.Header.Get("Access-Control-Allow-Headers"), "Authorization")) {
				t.Fatalf("missing CORS headers: %v", response.Header)
			}
		})
	}
}

func callHTTP(t *testing.T, service *httptest.Server, method, path, token, body string, want int) string {
	t.Helper()
	request, err := http.NewRequest(method, service.URL+path, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", "Bearer "+token)
	response, err := service.Client().Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = response.Body.Close() }()
	raw, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != want {
		t.Fatalf("status %d, want %d: %s", response.StatusCode, want, raw)
	}
	return string(raw)
}

func TestGuestInviteAccessLimitsAndRevocation(t *testing.T) {
	service := testServer(t)
	owner, callID := start(t, service)
	path := "/v1/calls/" + callID + "/invites"
	callHTTP(t, service, "POST", path, "outsider", "{}", http.StatusForbidden)
	callHTTP(t, service, "POST", path, "member", "{}", http.StatusForbidden)
	callHTTP(t, service, "POST", path, "owner", `{"max_uses":0}`, http.StatusBadRequest)

	makeInvite := func() (string, string) {
		raw := callHTTP(t, service, "POST", path, "owner", `{"max_uses":1}`, http.StatusCreated)
		var result fields
		if err := json.Unmarshal([]byte(raw), &result); err != nil {
			t.Fatal(err)
		}
		_, token, found := strings.Cut(result["invite_url"].(string), "#invite=")
		if !found || len(token) != 43 {
			t.Fatal("invite token missing")
		}
		return result["invite_id"].(string), token
	}
	inviteID, revokedToken := makeInvite()
	revoke := "/v1/calls/invites/" + inviteID
	callHTTP(t, service, "DELETE", revoke, "member", "", http.StatusForbidden)
	callHTTP(t, service, "DELETE", revoke, "owner", "", http.StatusNoContent)
	revoked := dial(t, service, fields{"invite_token": revokedToken})
	receive(t, revoked, "auth:error")

	_, token := makeInvite()
	declined := dial(t, service, fields{"invite_token": token})
	receive(t, declined, "auth:ok")
	receive(t, declined, "call:incoming")
	send(t, declined, "call:decline", fields{"call_id": callID})
	receive(t, declined, "call:ended")
	send(t, declined, "call:accept", fields{"call_id": callID})
	if problem := receive(t, declined, "call:error"); problem["code"] != "invite_invalid" {
		t.Fatalf("declined guest socket could still accept: %v", problem)
	}

	guest := dial(t, service, fields{"invite_token": token})
	auth := receive(t, guest, "auth:ok")
	if auth["guest"] != true || auth["call_id"] != callID {
		t.Fatalf("unexpected guest authorization: %v", auth)
	}
	if incoming := receive(t, guest, "call:incoming"); incoming["chat_id"] != nil {
		t.Fatal("guest received chat ID")
	}
	second := dial(t, service, fields{"invite_token": token})
	receive(t, second, "auth:ok")
	receive(t, second, "call:incoming")

	send(t, guest, "call:accept", fields{"call_id": callID})
	receive(t, guest, "call:accepted")
	receive(t, guest, "call:peer_joined")
	receive(t, owner, "call:accepted")
	if peer := receive(t, owner, "call:peer_joined"); peer["participant_type"] != "guest" || peer["display_name"] != "Гость 1" {
		t.Fatalf("unexpected guest: %v", peer)
	}
	send(t, second, "call:accept", fields{"call_id": callID})
	if problem := receive(t, second, "call:error"); problem["code"] != "invite_invalid" {
		t.Fatalf("invite limit not enforced: %v", problem)
	}
	send(t, guest, "call:end", fields{"call_id": callID})
	receive(t, owner, "call:peer_left")
	send(t, owner, "call:end", fields{"call_id": callID})
	receive(t, owner, "call:ended")
}

func TestUnavailablePythonAPI(t *testing.T) {
	python := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	t.Cleanup(python.Close)
	app := newServer(config.Config{PythonAPIURL: python.URL})
	service := httptest.NewServer(app.routes())
	t.Cleanup(service.Close)
	callHTTP(t, service, http.MethodPost, "/v1/calls/"+chatID+"/invites", "owner", "{}", http.StatusBadGateway)
	conn := dial(t, service, fields{"access_token": "owner"})
	if problem := receive(t, conn, "auth:error"); problem["code"] != "api_unavailable" {
		t.Fatalf("unexpected error for unavailable Python API: %v", problem)
	}
}
