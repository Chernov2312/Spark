package signaling

import (
	"testing"
	"time"

	"spark/calls/internal/livekit"
	"spark/calls/internal/sparkapi"
)

func TestExpireUnansweredCall(t *testing.T) {
	h, caller, member, current := ringingCall(t)
	h.expireAt(current.waitUntil.Add(-time.Millisecond))
	if activeChat, _, exists := h.callInfo(current.id); !exists || activeChat != chatID {
		t.Fatal("call expired before the deadline")
	}
	h.expireAt(current.waitUntil)
	for _, session := range []*client{caller, member} {
		ended := nextHubEvent(t, session, "call:ended")
		if ended["reason"] != "timeout" || ended["call_id"] != current.id {
			t.Fatalf("unexpected end event: %v", ended)
		}
	}
	if _, _, exists := h.callInfo(current.id); exists {
		t.Fatal("timed-out call is still available")
	}
	if problem := h.start(member, chatID, "audio", []sparkapi.Person{member.user, caller.user}); problem != nil {
		t.Fatalf("timeout did not free the chat and invited member: %s", problem.code)
	}
}

func TestInviteKeepsCallOpenUntilLastParticipantLeaves(t *testing.T) {
	h, caller, _, current := ringingCall(t)
	future := current.waitUntil.Add(48 * time.Hour)
	entry, token, ok := h.addInvite(current.id, caller.peerID, 0)
	if !ok {
		t.Fatal("failed to create invite")
	}

	h.expireAt(future)
	guest := localClient("")
	if !h.authorizeGuest(guest, token) {
		t.Fatal("invite expired while the caller was waiting")
	}
	if problem := h.accept(guest, current.id, "", false); problem != nil {
		t.Fatalf("guest could not join: %s", problem.code)
	}
	h.disconnect(caller)
	h.expireAt(future)
	if h.mediaSession(current.id, caller.mediaIdentity) != nil || h.mediaSession(current.id, guest.mediaIdentity) == nil {
		t.Fatal("caller departure did not preserve the remaining guest's media session")
	}
	waiting := localClient("")
	if !h.authorizeGuest(waiting, token) {
		t.Fatal("invite expired with a guest still in the call")
	}
	h.connect(waiting)
	nextHubEvent(t, waiting, "call:incoming")
	if problem := h.leave(guest, current.id); problem != nil {
		t.Fatalf("guest could not leave: %s", problem.code)
	}
	nextHubEvent(t, waiting, "call:ended")
	if _, _, exists := h.callInfo(current.id); exists || h.invites[entry.id] != nil || h.authorizeGuest(localClient(""), token) {
		t.Fatal("call or invite remained active after the last participant left")
	}
}

func ringingCall(t *testing.T) (*hub, *client, *client, *call) {
	t.Helper()
	h := newHub(livekit.New(nil, "test-key", testMediaSecret))
	caller, member := localClient(ownerID), localClient(memberID)
	h.connect(caller)
	h.connect(member)
	if problem := h.start(caller, chatID, "audio", []sparkapi.Person{caller.user, member.user}); problem != nil {
		t.Fatalf("start call: %s", problem.code)
	}
	started := nextHubEvent(t, caller, "call:started")
	callID := started["call_id"].(string)
	nextHubEvent(t, member, "call:incoming")
	return h, caller, member, h.calls[callID]
}

func localClient(id string) *client {
	return &client{user: sparkapi.Person{ID: id}, peerID: id, out: make(chan event, 16), done: make(chan struct{})}
}

func nextHubEvent(t *testing.T, c *client, want string) fields {
	t.Helper()
	select {
	case item := <-c.out:
		if item.Event != want {
			t.Fatalf("event = %s, want %s (%v)", item.Event, want, item.Data)
		}
		return item.Data
	default:
		t.Fatalf("no event published, want %s", want)
		return nil
	}
}
