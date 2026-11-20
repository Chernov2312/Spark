package signaling

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"spark/calls/internal/config"
	"spark/calls/internal/sparkapi"
)

const unansweredTimeout = 90 * time.Second

func newID() string {
	var value [16]byte
	rand.Read(value[:])
	value[6] = (value[6] & 0x0f) | 0x40
	value[8] = (value[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", value[:4], value[4:6], value[6:8], value[8:10], value[10:])
}

type call struct {
	id        string
	chatID    string
	media     string
	creator   *client
	peers     map[string]*client
	ringing   map[string]bool
	guests    int
	waitUntil time.Time
}

type hub struct {
	mu      sync.Mutex
	ice     func(string) []config.ICEServer
	clients map[*client]bool
	online  map[string]map[*client]bool
	calls   map[string]*call
	byChat  map[string]string
	active  map[string]string
	pending map[string]string
	invites map[string]*invite
	byHash  map[[32]byte]*invite
}

func newHub(ice func(string) []config.ICEServer) *hub {
	return &hub{
		ice: ice, clients: make(map[*client]bool),
		online: make(map[string]map[*client]bool), calls: make(map[string]*call),
		byChat: make(map[string]string), active: make(map[string]string),
		pending: make(map[string]string), invites: make(map[string]*invite),
		byHash: make(map[[32]byte]*invite),
	}
}

func (h *hub) incoming(c *client, current *call) {
	data := fields{
		"call_id": current.id, "media": current.media,
		"caller_name": current.creator.user.Username,
	}
	if !c.guest {
		data["chat_id"] = current.chatID
	}
	c.emit("call:incoming", data)
}

func (h *hub) connect(c *client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.clients[c] = true
	if c.guest {
		if current := h.calls[c.guestCall]; current != nil {
			h.incoming(c, current)
		} else {
			c.emit("call:ended", fields{"call_id": c.guestCall})
		}
		return
	}
	if h.online[c.peerID] == nil {
		h.online[c.peerID] = make(map[*client]bool)
	}
	h.online[c.peerID][c] = true
	if current := h.calls[h.pending[c.peerID]]; current != nil {
		h.incoming(c, current)
	}
}

func (h *hub) disconnect(c *client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.clients, c)
	group := h.online[c.peerID]
	delete(group, c)
	if len(group) == 0 {
		delete(h.online, c.peerID)
	}
	if current := h.calls[h.active[c.peerID]]; current != nil && current.peers[c.peerID] == c {
		h.leaveLocked(current, c)
	}
}

func (h *hub) start(c *client, chatID, media string, members []sparkapi.Person) *failure {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.active[c.peerID] != "" || h.pending[c.peerID] != "" {
		return busy
	}
	if h.byChat[chatID] != "" {
		return &failure{"chat_busy", "В этом чате уже идёт звонок."}
	}
	current := &call{
		id: newID(), chatID: chatID, media: media, creator: c,
		peers: map[string]*client{c.peerID: c}, ringing: make(map[string]bool),
		waitUntil: time.Now().Add(unansweredTimeout),
	}
	h.calls[current.id] = current
	h.byChat[chatID] = current.id
	h.active[c.peerID] = current.id
	c.emit("call:started", fields{
		"call_id": current.id, "chat_id": chatID, "media": media, "ice_servers": h.ice(c.peerID),
	})
	for _, member := range members {
		if member.ID == c.peerID || h.active[member.ID] != "" || h.pending[member.ID] != "" || len(h.online[member.ID]) == 0 {
			continue
		}
		current.ringing[member.ID] = true
		h.pending[member.ID] = current.id
		for session := range h.online[member.ID] {
			h.incoming(session, current)
		}
	}
	return nil
}

func (h *hub) chatID(callID string) string {
	h.mu.Lock()
	defer h.mu.Unlock()
	if current := h.calls[callID]; current != nil {
		return current.chatID
	}
	return ""
}

func (h *hub) accept(c *client, id string) *failure {
	h.mu.Lock()
	defer h.mu.Unlock()
	current := h.calls[id]
	if current == nil {
		return unavailable
	}
	if current.peers[c.peerID] == c {
		return nil
	}
	if h.active[c.peerID] != "" {
		return busy
	}
	if c.guest {
		entry := h.byHash[c.inviteHash]
		if c.guestCall != id || entry == nil || !entry.usable(time.Now()) {
			return invalidInvite
		}
		entry.uses++
		current.guests++
		c.user.Username = fmt.Sprintf("Гость %d", current.guests)
	} else {
		if h.pending[c.peerID] != id {
			return denied
		}
		delete(h.pending, c.peerID)
		delete(current.ringing, c.peerID)
		for sibling := range h.online[c.peerID] {
			if sibling != c {
				sibling.emit("call:ended", fields{"call_id": id, "reason": "answered_elsewhere"})
			}
		}
	}
	c.emit("call:accepted", fields{"call_id": id, "peer_id": c.peerID, "ice_servers": h.ice(c.peerID)})
	for _, other := range current.peers {
		other.emit("call:accepted", fields{"call_id": id, "peer_id": c.peerID})
		other.emit("call:peer_joined", peerEvent(id, c, true))
		c.emit("call:peer_joined", peerEvent(id, other, false))
	}
	current.peers[c.peerID] = c
	h.active[c.peerID] = id
	return nil
}

func peerEvent(callID string, c *client, shouldOffer bool) fields {
	kind := "user"
	if c.guest {
		kind = "guest"
	}
	return fields{
		"call_id": callID, "peer_id": c.peerID, "display_name": c.user.Username,
		"should_offer": shouldOffer, "participant_type": kind,
	}
}

func (h *hub) decline(c *client, id string) *failure {
	h.mu.Lock()
	defer h.mu.Unlock()
	current := h.calls[id]
	if current == nil {
		return unavailable
	}
	if c.guest {
		if c.guestCall != id || current.peers[c.peerID] != nil {
			return denied
		}
		c.guestCall = ""
		c.emit("call:ended", fields{"call_id": id})
		return nil
	}
	if h.pending[c.peerID] != id {
		return denied
	}
	delete(h.pending, c.peerID)
	delete(current.ringing, c.peerID)
	for sibling := range h.online[c.peerID] {
		sibling.emit("call:ended", fields{"call_id": id})
	}
	current.creator.emit("call:declined", fields{
		"call_id": id, "message": "Участник отклонил звонок.",
	})
	return nil
}

func (h *hub) signal(c *client, id, targetID, name string, value json.RawMessage) *failure {
	h.mu.Lock()
	defer h.mu.Unlock()
	current := h.calls[id]
	if current == nil || current.peers[c.peerID] != c {
		return denied
	}
	target := current.peers[targetID]
	if target == nil || target == c {
		return denied
	}
	key := "sdp"
	if name == "rtc:ice" {
		key = "candidate"
	}
	target.emit(name, fields{
		"call_id": id, "from_id": c.peerID, "target_id": targetID, key: value,
	})
	return nil
}

func (h *hub) leave(c *client, id string) *failure {
	h.mu.Lock()
	defer h.mu.Unlock()
	current := h.calls[id]
	if current == nil || current.peers[c.peerID] != c {
		return denied
	}
	h.leaveLocked(current, c)
	return nil
}

func (h *hub) leaveLocked(current *call, c *client) {
	if current.creator == c {
		h.endLocked(current, "ended")
		return
	}
	delete(current.peers, c.peerID)
	delete(h.active, c.peerID)
	if c.guest {
		c.guestCall = ""
	}
	for _, other := range current.peers {
		other.emit("call:peer_left", fields{"call_id": current.id, "peer_id": c.peerID})
	}
	c.emit("call:ended", fields{"call_id": current.id})
	if len(current.peers) == 1 {
		current.waitUntil = time.Now().Add(unansweredTimeout)
	}
}

func (h *hub) endLocked(current *call, reason string) {
	data := fields{"call_id": current.id, "reason": reason}
	for id, session := range current.peers {
		delete(h.active, id)
		session.emit("call:ended", data)
	}
	for id := range current.ringing {
		delete(h.pending, id)
		for session := range h.online[id] {
			session.emit("call:ended", data)
		}
	}
	for session := range h.clients {
		if session.guestCall == current.id && current.peers[session.peerID] != session {
			session.emit("call:ended", data)
		}
	}
	for _, entry := range h.invites {
		if entry.callID == current.id {
			h.removeInviteLocked(entry)
		}
	}
	delete(h.byChat, current.chatID)
	delete(h.calls, current.id)
}

func (h *hub) expire(ctx context.Context) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-ticker.C:
			h.expireAt(now)
		}
	}
}

func (h *hub) expireAt(now time.Time) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, current := range h.calls {
		if len(current.peers) == 1 && !now.Before(current.waitUntil) {
			h.endLocked(current, "timeout")
		}
	}
	for _, entry := range h.invites {
		if !entry.usable(now) {
			h.removeInviteLocked(entry)
		}
	}
}

func (h *hub) close() {
	h.mu.Lock()
	defer h.mu.Unlock()
	for c := range h.clients {
		_ = c.conn.Close()
	}
}
