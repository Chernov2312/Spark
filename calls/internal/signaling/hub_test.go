package signaling

import (
	"testing"
	"time"

	"spark/calls/internal/livekit"
	"spark/calls/internal/sparkapi"
)

func TestExpireUnansweredCall(t *testing.T) {
	h, caller, member, current := ringingCall(t)
	entry, token, ok := h.addInvite(current.id, caller.peerID, 120, 1)
	if !ok {
		t.Fatal("failed to create invite")
	}
	guest := localClient("")
	if !h.authorizeGuest(guest, token) {
		t.Fatal("guest could not authenticate with a fresh invite")
	}
	h.connect(guest)
	if incoming := nextHubEvent(t, guest, "call:incoming"); incoming["call_id"] != current.id {
		t.Fatalf("unexpected guest invitation: %v", incoming)
	}

	h.expireAt(current.waitUntil.Add(-time.Millisecond))
	if activeChat, _, exists := h.callInfo(current.id); !exists || activeChat != chatID {
		t.Fatal("call expired before the deadline")
	}
	h.expireAt(current.waitUntil)
	for _, session := range []*client{caller, member, guest} {
		ended := nextHubEvent(t, session, "call:ended")
		if ended["reason"] != "timeout" || ended["call_id"] != current.id {
			t.Fatalf("unexpected end event: %v", ended)
		}
	}
	if _, _, exists := h.callInfo(current.id); exists || h.invites[entry.id] != nil || h.authorizeGuest(localClient(""), token) {
		t.Fatal("timed-out call or its invite is still available")
	}
	if problem := h.start(member, chatID, "audio", []sparkapi.Person{member.user, caller.user}); problem != nil {
		t.Fatalf("timeout did not free the chat and invited member: %s", problem.code)
	}
}

func TestExpireInviteDuringEstablishedCall(t *testing.T) {
	h, caller, member, current := ringingCall(t)
	entry, token, ok := h.addInvite(current.id, caller.peerID, 60, 1)
	if !ok {
		t.Fatal("failed to create invite")
	}
	if problem := h.accept(member, current.id, "", false); problem != nil {
		t.Fatalf("member could not accept call: %s", problem.code)
	}

	h.expireAt(current.waitUntil)
	if activeChat, _, exists := h.callInfo(current.id); !exists || activeChat != chatID {
		t.Fatal("established call expired at the ringing deadline")
	}
	if h.invites[entry.id] != nil || h.authorizeGuest(localClient(""), token) {
		t.Fatal("expired invite remained usable")
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
