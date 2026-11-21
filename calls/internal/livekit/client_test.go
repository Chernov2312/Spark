package livekit

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const testKey = "test-key"
const testSecret = "test-secret-for-livekit-token-signing"

func TestJoinTokenGrants(t *testing.T) {
	client := New(nil, testKey, testSecret)
	token, err := client.JoinToken("room", "member")
	if err != nil {
		t.Fatal(err)
	}
	room, identity, ok := client.JoinIdentity(token)
	if !ok || room != "room" || identity != "member" {
		t.Fatalf("unexpected join identity: %q %q %t", room, identity, ok)
	}
	grant := readGrant(t, token)
	if !grant.RoomJoin || grant.RoomAdmin || grant.RoomCreate ||
		grant.CanPublish == nil || !*grant.CanPublish || grant.CanSubscribe == nil || !*grant.CanSubscribe ||
		grant.CanPublishData == nil || *grant.CanPublishData || grant.CanUpdateOwnMetadata == nil || *grant.CanUpdateOwnMetadata ||
		!reflect.DeepEqual(grant.CanPublishSources, []string{"microphone", "camera", "screen_share"}) {
		t.Fatalf("unexpected room grants: %+v", grant)
	}
	expired, err := client.sign("member", videoGrant{Room: "room", RoomJoin: true}, -time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	noJoin, err := client.sign("member", videoGrant{Room: "room", RoomAdmin: true}, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	for _, invalid := range []string{"", expired, noJoin, token + "a", strings.Repeat("x", 8193)} {
		if _, _, accepted := client.JoinIdentity(invalid); accepted {
			t.Fatal("accepted an invalid LiveKit join token")
		}
	}
}

func TestRemoveUsesScopedRoomServiceGrants(t *testing.T) {
	requests := make(chan string, 2)
	service := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if req.Method != http.MethodPost || req.Header.Get("Content-Type") != "application/json" {
			t.Error("invalid RoomService request")
		}
		var body map[string]string
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil || body["room"] != "room" {
			t.Errorf("invalid RoomService body: %v, %v", body, err)
		}
		grant := readGrant(t, strings.TrimPrefix(req.Header.Get("Authorization"), "Bearer "))
		if grant.RoomJoin {
			t.Error("administrative token can join calls")
		}
		if body["identity"] != "" {
			if body["identity"] != "member" || !grant.RoomAdmin || grant.RoomCreate || grant.Room != "room" {
				t.Error("participant cleanup token should be limited to its room")
			}
			w.WriteHeader(http.StatusOK)
		} else {
			if !grant.RoomCreate || grant.RoomAdmin {
				t.Error("invalid room cleanup token")
			}
			w.WriteHeader(http.StatusNotFound)
		}
		requests <- req.URL.Path
	}))
	t.Cleanup(service.Close)
	serverURL, err := url.Parse(service.URL)
	if err != nil {
		t.Fatal(err)
	}
	client := New(serverURL, testKey, testSecret)
	for _, request := range []struct{ peer, method string }{{"member", "RemoveParticipant"}, {"", "DeleteRoom"}} {
		if err := client.Remove("room", request.peer); err != nil {
			t.Fatal(err)
		}
		if path := <-requests; path != "/twirp/livekit.RoomService/"+request.method {
			t.Fatalf("unexpected RoomService method: %s", path)
		}
	}
}

func readGrant(t *testing.T, token string) videoGrant {
	t.Helper()
	value := new(claims)
	_, err := jwt.ParseWithClaims(token, value, func(*jwt.Token) (any, error) { return []byte(testSecret), nil },
		jwt.WithValidMethods([]string{"HS256"}), jwt.WithIssuer(testKey), jwt.WithExpirationRequired())
	if err != nil {
		t.Errorf("invalid issued token: %v", err)
	}
	return value.Video
}
