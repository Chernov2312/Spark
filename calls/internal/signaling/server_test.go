package signaling

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"spark/calls/internal/config"
	"spark/calls/internal/livekit"
	"spark/calls/internal/sparkapi"
)

const (
	ownerID         = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa"
	memberID        = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb"
	outsiderID      = "cccccccc-cccc-4ccc-cccc-cccccccccccc"
	chatID          = "dddddddd-dddd-4ddd-dddd-dddddddddddd"
	testMediaSecret = "test-livekit-secret-not-used-in-production"
)

func TestConfiguredOrigins(t *testing.T) {
	t.Setenv("FRONTEND_BASE_URL", "https://spark.example")
	t.Setenv("CALLS_ALLOWED_ORIGINS", "https://test.spark.example, http://localhost:5174")
	t.Setenv("LIVEKIT_API_KEY", "test-key")
	t.Setenv("LIVEKIT_API_SECRET", testMediaSecret)
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
	return testServerWithMedia(t, http.NotFoundHandler())
}

func testServerWithMedia(t *testing.T, mediaHandler http.Handler) *httptest.Server {
	t.Helper()
	media := httptest.NewServer(mediaHandler)
	t.Cleanup(media.Close)
	mediaURL, err := url.Parse(media.URL)
	if err != nil {
		t.Fatal(err)
	}
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
		LiveKitURL: mediaURL, LiveKitAPIKey: "test-key", LiveKitSecret: testMediaSecret,
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

func TestMemberCallAuthorizesMediaAndDisconnects(t *testing.T) {
	type cleanupRequest struct {
		path string
		body map[string]string
	}
	cleanups := make(chan cleanupRequest, 4)
	service := testServerWithMedia(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/rtc/validate":
			w.WriteHeader(http.StatusOK)
		case r.URL.Path == "/rtc/v1":
			upgrader := websocket.Upgrader{}
			conn, err := upgrader.Upgrade(w, r, nil)
			if err != nil {
				return
			}
			defer func() { _ = conn.Close() }()
			_ = conn.WriteMessage(websocket.TextMessage, []byte("livekit"))
			_, _, _ = conn.ReadMessage()
		case strings.HasPrefix(r.URL.Path, "/twirp/"):
			var body map[string]string
			_ = json.NewDecoder(r.Body).Decode(&body)
			cleanups <- cleanupRequest{r.URL.Path, body}
			w.WriteHeader(http.StatusOK)
		default:
			http.NotFound(w, r)
		}
	}))
	expectCleanup := func(method string, room, identity string) {
		t.Helper()
		select {
		case cleanup := <-cleanups:
			if cleanup.path != "/twirp/livekit.RoomService/"+method ||
				cleanup.body["room"] != room || cleanup.body["identity"] != identity {
				t.Fatalf("unexpected media cleanup: %+v", cleanup)
			}
		case <-time.After(3 * time.Second):
			t.Fatalf("missing LiveKit %s", method)
		}
	}

	member := dial(t, service, fields{"access_token": "member"})
	receive(t, member, "auth:ok")
	outsider := dial(t, service, fields{"access_token": "outsider"})
	receive(t, outsider, "auth:ok")
	send(t, outsider, "call:start", fields{"chat_id": chatID, "media": "audio"})
	receive(t, outsider, "call:error")

	owner := dial(t, service, fields{"access_token": "owner"})
	receive(t, owner, "auth:ok")
	send(t, owner, "call:start", fields{"chat_id": chatID, "media": "video"})
	started := receive(t, owner, "call:started")
	callID := started["call_id"].(string)
	ownerToken := expectMediaToken(t, started, callID)
	incoming := receive(t, member, "call:incoming")
	if incoming["call_id"] != callID || incoming["media"] != "video" ||
		incoming["caller_name"] != "Владелец" || incoming["media_token"] != nil {
		t.Fatalf("unexpected incoming call: %v", incoming)
	}

	send(t, outsider, "call:accept", fields{"call_id": callID})
	receive(t, outsider, "call:error")
	checkMediaStatus(t, service, "", http.StatusUnauthorized)
	checkMediaStatus(t, service, "invalid", http.StatusUnauthorized)
	unacceptedToken, err := livekit.New(nil, "test-key", testMediaSecret).JoinToken(callID, memberID)
	if err != nil {
		t.Fatal(err)
	}
	checkMediaStatus(t, service, unacceptedToken, http.StatusForbidden)
	checkMediaStatus(t, service, ownerToken, http.StatusOK)

	send(t, member, "call:accept", fields{"call_id": callID})
	accepted := receive(t, member, "call:accepted")
	memberToken := expectMediaToken(t, accepted, callID)
	if peer := receive(t, member, "call:peer_joined"); peer["peer_id"] != ownerID || peer["media_identity"] != started["media_identity"] {
		t.Fatalf("unexpected caller: %v", peer)
	}
	if other := receive(t, owner, "call:accepted"); other["media_token"] != nil {
		t.Fatal("member token was disclosed to the owner")
	}
	if peer := receive(t, owner, "call:peer_joined"); peer["peer_id"] != memberID || peer["media_identity"] != accepted["media_identity"] {
		t.Fatalf("unexpected participant: %v", peer)
	}
	checkMediaStatus(t, service, memberToken, http.StatusOK)

	mediaConn, _, err := websocket.DefaultDialer.Dial(
		"ws"+strings.TrimPrefix(service.URL, "http")+"/v1/calls/media/rtc/v1?access_token="+url.QueryEscape(memberToken), nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = mediaConn.Close() })
	_ = mediaConn.SetReadDeadline(time.Now().Add(3 * time.Second))
	if _, payload, err := mediaConn.ReadMessage(); err != nil || string(payload) != "livekit" {
		t.Fatalf("LiveKit WebSocket upgrade was not proxied: %s, %v", payload, err)
	}
	if err := member.Close(); err != nil {
		t.Fatal(err)
	}
	if left := receive(t, owner, "call:peer_left"); left["peer_id"] != memberID {
		t.Fatalf("unexpected disconnected participant: %v", left)
	}
	expectCleanup("RemoveParticipant", callID, accepted["media_identity"].(string))
	checkMediaStatus(t, service, memberToken, http.StatusForbidden)
	_ = mediaConn.SetReadDeadline(time.Now().Add(3 * time.Second))
	if _, _, err := mediaConn.ReadMessage(); err == nil {
		t.Fatal("media tunnel remained open after leaving the call")
	} else if timeout, ok := err.(interface{ Timeout() bool }); ok && timeout.Timeout() {
		t.Fatalf("media tunnel did not close promptly: %v", err)
	}

	send(t, owner, "call:end", fields{"call_id": callID})
	receive(t, owner, "call:ended")
	expectCleanup("DeleteRoom", callID, "")
	checkMediaStatus(t, service, ownerToken, http.StatusForbidden)
	_, nextID := start(t, service)
	if nextID == callID {
		t.Fatal("ended call ID was reused")
	}
}

func expectMediaToken(t *testing.T, data fields, room string) string {
	t.Helper()
	token, _ := data["media_token"].(string)
	issuedRoom, issuedIdentity, ok := livekit.New(nil, "test-key", testMediaSecret).JoinIdentity(token)
	if !ok || issuedRoom != room || issuedIdentity != data["media_identity"] || !sparkapi.ValidID(issuedIdentity) {
		t.Fatal("invalid media token")
	}
	return token
}

func checkMediaStatus(t *testing.T, service *httptest.Server, token string, expected int) {
	t.Helper()
	resp, err := service.Client().Get(service.URL + "/v1/calls/media/rtc/validate?access_token=" + url.QueryEscape(token))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != expected {
		t.Fatalf("media status = %d, want %d", resp.StatusCode, expected)
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

func TestLateChatMemberWatchesAndJoinsActiveCall(t *testing.T) {
	service := testServer(t)
	owner, callID := start(t, service)
	member := dial(t, service, fields{"access_token": "member"})
	receive(t, member, "auth:ok")
	send(t, member, "call:watch", fields{"chat_id": chatID})
	if status := receive(t, member, "call:status"); status["call_id"] != callID || status["participant_count"] != float64(1) {
		t.Fatalf("unexpected active call: %v", status)
	}
	outsider := dial(t, service, fields{"access_token": "outsider"})
	receive(t, outsider, "auth:ok")
	send(t, outsider, "call:watch", fields{"chat_id": chatID})
	if status := receive(t, outsider, "call:status"); status["call_id"] != nil {
		t.Fatal("non-member received active call details")
	}
	send(t, outsider, "call:join", fields{"call_id": callID})
	receive(t, outsider, "call:error")

	join := func() fields {
		t.Helper()
		send(t, member, "call:join", fields{"call_id": callID})
		accepted := receive(t, member, "call:accepted")
		expectMediaToken(t, accepted, callID)
		receive(t, member, "call:peer_joined")
		receive(t, owner, "call:accepted")
		receive(t, owner, "call:peer_joined")
		if status := receive(t, member, "call:status"); status["participant_count"] != float64(2) {
			t.Fatalf("watch did not report the new participant: %v", status)
		}
		return accepted
	}
	first := join()
	send(t, member, "call:end", fields{"call_id": callID})
	receive(t, owner, "call:peer_left")
	receive(t, member, "call:ended")
	receive(t, member, "call:status")
	next := join()
	if next["media_identity"] == first["media_identity"] {
		t.Fatal("rejoining reused the old LiveKit session")
	}
	checkMediaStatus(t, service, first["media_token"].(string), http.StatusForbidden)
	send(t, owner, "call:end", fields{"call_id": callID})
	receive(t, owner, "call:ended")
	receive(t, member, "call:ended")
	if status := receive(t, member, "call:status"); status["call_id"] != nil {
		t.Fatalf("status retained the ended call: %v", status)
	}
}

func TestStandaloneCallSupportsInvitationWithoutChat(t *testing.T) {
	service := testServerWithMedia(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	owner := dial(t, service, fields{"access_token": "owner"})
	receive(t, owner, "auth:ok")
	send(t, owner, "call:check", fields{})
	if health := receive(t, owner, "call:checked"); health["media_ready"] != true {
		t.Fatalf("healthy LiveKit failed prejoin check: %v", health)
	}
	send(t, owner, "call:start", fields{"media": "audio"})
	started := receive(t, owner, "call:started")
	callID := started["call_id"].(string)
	expectMediaToken(t, started, callID)
	if started["chat_id"] != "" {
		t.Fatalf("standalone call has a chat: %v", started["chat_id"])
	}
	path := "/v1/calls/" + callID + "/invites"
	callHTTP(t, service, http.MethodPost, path, "member", "{}", http.StatusForbidden)
	raw := callHTTP(t, service, http.MethodPost, path, "owner", "{}", http.StatusCreated)
	var invite fields
	if err := json.Unmarshal([]byte(raw), &invite); err != nil {
		t.Fatal(err)
	}
	_, token, _ := strings.Cut(invite["invite_url"].(string), "#invite=")
	guest := dial(t, service, fields{"invite_token": token})
	receive(t, guest, "auth:ok")
	receive(t, guest, "call:incoming")
	send(t, guest, "call:accept", fields{"call_id": callID})
	expectMediaToken(t, receive(t, guest, "call:accepted"), callID)
	receive(t, owner, "call:accepted")
	receive(t, owner, "call:peer_joined")
	revoke := "/v1/calls/invites/" + invite["invite_id"].(string)
	callHTTP(t, service, http.MethodDelete, revoke, "member", "", http.StatusForbidden)
	callHTTP(t, service, http.MethodDelete, revoke, "owner", "", http.StatusNoContent)
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
	send(t, caller, "rtc:offer", fields{"call_id": callID})
	if problem := receive(t, caller, "call:error"); problem["code"] != "unsupported_event" {
		t.Fatalf("legacy WebRTC signaling was accepted: %v", problem)
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
	owner := dial(t, service, fields{"access_token": "owner"})
	receive(t, owner, "auth:ok")
	send(t, owner, "call:start", fields{"chat_id": chatID, "media": "audio"})
	callID := receive(t, owner, "call:started")["call_id"].(string)
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

	for _, name := range []string{strings.Repeat("я", guestNameMaxLength+1), "Гость\x00Имя"} {
		send(t, guest, "call:accept", fields{"call_id": callID, "display_name": name})
		if problem := receive(t, guest, "call:error"); problem["code"] != "invalid_guest_name" {
			t.Fatalf("accepted an invalid guest name: %v", problem)
		}
	}
	send(t, guest, "call:accept", fields{"call_id": callID, "display_name": "  Мира 🌿  "})
	accepted := receive(t, guest, "call:accepted")
	guestToken := expectMediaToken(t, accepted, callID)
	if accepted["peer_id"] != auth["peer_id"] {
		t.Fatal("guest peer ID changed upon joining")
	}
	checkMediaStatus(t, service, guestToken, http.StatusNotFound)
	if peer := receive(t, guest, "call:peer_joined"); peer["peer_id"] != ownerID {
		t.Fatalf("unexpected owner: %v", peer)
	}
	if other := receive(t, owner, "call:accepted"); other["media_token"] != nil {
		t.Fatal("guest token was disclosed to the owner")
	}
	if peer := receive(t, owner, "call:peer_joined"); peer["participant_type"] != "guest" || peer["display_name"] != "Мира 🌿" {
		t.Fatalf("unexpected guest: %v", peer)
	}
	send(t, second, "call:accept", fields{"call_id": callID})
	if problem := receive(t, second, "call:error"); problem["code"] != "invite_invalid" {
		t.Fatalf("invite limit not enforced: %v", problem)
	}
	send(t, guest, "call:end", fields{"call_id": callID})
	receive(t, owner, "call:peer_left")
	_, newToken := makeInvite()
	unnamed := dial(t, service, fields{"invite_token": newToken})
	receive(t, unnamed, "auth:ok")
	receive(t, unnamed, "call:incoming")
	send(t, unnamed, "call:accept", fields{"call_id": callID, "display_name": "  "})
	receive(t, unnamed, "call:accepted")
	receive(t, owner, "call:accepted")
	if peer := receive(t, owner, "call:peer_joined"); peer["display_name"] != "Гость 2" {
		t.Fatalf("unexpected default guest name: %v", peer)
	}
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
