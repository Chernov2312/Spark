package signaling

import (
	"context"
	"crypto/rand"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"

	"spark/calls/internal/livekit"
	"spark/calls/internal/sparkapi"
)

const unansweredTimeout = 90 * time.Second
const guestNameMaxLength = 50

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
	media   livekit.Client
	clients map[*client]bool
	online  map[string]map[*client]bool
	calls   map[string]*call
	byChat  map[string]string
	active  map[string]string
	pending map[string]string
	invites map[string]*invite
	byHash  map[[32]byte]*invite
}

func newHub(media livekit.Client) *hub {
	return &hub{
		media: media, clients: make(map[*client]bool),
		online: make(map[string]map[*client]bool), calls: make(map[string]*call),
		byChat: make(map[string]string), active: make(map[string]string),
		pending: make(map[string]string), invites: make(map[string]*invite),
		byHash: make(map[[32]byte]*invite),
	}
}

func (h *hub) incoming(c *client, current *call) {
	data := fields{
		"call_id": current.id, "media": current.media,
		"caller_name": current.creator.user.Username, "participant_count": len(current.peers),
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
	delete(h.clients, c)
	group := h.online[c.peerID]
	delete(group, c)
	if len(group) == 0 {
		delete(h.online, c.peerID)
	}
	if current := h.calls[h.active[c.peerID]]; current != nil && current.peers[c.peerID] == c {
		departure := h.leaveLocked(current, c)
		h.mu.Unlock()
		h.removeMedia(departure)
		return
	}
	h.mu.Unlock()
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
	}
	if chatID != "" {
		current.waitUntil = time.Now().Add(unansweredTimeout)
	}
	mediaIdentity := newID()
	token, err := h.media.JoinToken(current.id, mediaIdentity)
	if err != nil {
		return mediaUnavailable
	}
	c.mediaContext, c.cancelMedia = context.WithCancel(context.Background())
	c.mediaIdentity = mediaIdentity
	h.calls[current.id] = current
	if chatID != "" {
		h.byChat[chatID] = current.id
	}
	h.active[c.peerID] = current.id
	c.emit("call:started", fields{
		"call_id": current.id, "chat_id": chatID, "media": media, "media_token": token, "media_identity": mediaIdentity,
	})
	h.publishChatCallLocked(chatID)
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

func (h *hub) callInfo(callID string) (chatID, creatorID string, exists bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if current := h.calls[callID]; current != nil {
		return current.chatID, current.creator.peerID, true
	}
	return "", "", false
}

func (h *hub) watch(c *client, chatID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	c.watchedChat = chatID
	if chatID != "" {
		c.emit("call:status", h.chatCallLocked(chatID))
	}
}

func (h *hub) chatCallLocked(chatID string) fields {
	status := fields{"chat_id": chatID}
	if current := h.calls[h.byChat[chatID]]; current != nil {
		status["call_id"] = current.id
		status["caller_name"] = current.creator.user.Username
		status["media"] = current.media
		status["participant_count"] = len(current.peers)
	}
	return status
}

func (h *hub) publishChatCallLocked(chatID string) {
	if chatID == "" {
		return
	}
	status := h.chatCallLocked(chatID)
	for session := range h.clients {
		if session.watchedChat == chatID {
			session.emit("call:status", status)
		}
	}
}

func (h *hub) mediaSession(callID, mediaIdentity string) context.Context {
	h.mu.Lock()
	defer h.mu.Unlock()
	if current := h.calls[callID]; current != nil {
		for _, peer := range current.peers {
			if peer.mediaIdentity == mediaIdentity {
				return peer.mediaContext
			}
		}
	}
	return nil
}

func (h *hub) accept(c *client, id, guestName string, joinFromChat bool) *failure {
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
	if !c.guest {
		pending := h.pending[c.peerID]
		if !joinFromChat && pending != id {
			return denied
		}
		if pending != "" && pending != id {
			return busy
		}
	}
	mediaIdentity := newID()
	token, err := h.media.JoinToken(id, mediaIdentity)
	if err != nil {
		return mediaUnavailable
	}
	if c.guest {
		entry := h.byHash[c.inviteHash]
		if c.guestCall != id || entry == nil {
			return invalidInvite
		}
		guestName = strings.TrimSpace(guestName)
		if utf8.RuneCountInString(guestName) > guestNameMaxLength || strings.ContainsFunc(guestName, unicode.IsControl) {
			return &failure{"invalid_guest_name", "Введите ник до 50 символов без управляющих символов."}
		}
		if entry.usesLeft > 0 {
			entry.usesLeft--
			if entry.usesLeft == 0 {
				h.removeInviteLocked(entry)
			}
		}
		current.guests++
		if guestName == "" {
			guestName = fmt.Sprintf("Гость %d", current.guests)
		}
		c.user.Username = guestName
	} else {
		delete(h.pending, c.peerID)
		delete(current.ringing, c.peerID)
		for sibling := range h.online[c.peerID] {
			if sibling != c {
				sibling.emit("call:ended", fields{"call_id": id, "reason": "answered_elsewhere"})
			}
		}
	}
	c.mediaContext, c.cancelMedia = context.WithCancel(context.Background())
	c.mediaIdentity = mediaIdentity
	c.emit("call:accepted", fields{"call_id": id, "peer_id": c.peerID, "media_token": token, "media_identity": mediaIdentity})
	for _, other := range current.peers {
		other.emit("call:accepted", fields{"call_id": id, "peer_id": c.peerID})
		other.emit("call:peer_joined", peerEvent(id, c))
		c.emit("call:peer_joined", peerEvent(id, other))
	}
	current.peers[c.peerID] = c
	current.waitUntil = time.Time{}
	h.active[c.peerID] = id
	h.publishChatCallLocked(current.chatID)
	return nil
}

func peerEvent(callID string, c *client) fields {
	kind := "user"
	if c.guest {
		kind = "guest"
	}
	return fields{
		"call_id": callID, "peer_id": c.peerID, "display_name": c.user.Username,
		"participant_type": kind, "media_identity": c.mediaIdentity,
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
	if creator := current.peers[current.creator.peerID]; creator != nil {
		creator.emit("call:declined", fields{
			"call_id": id, "message": "Участник отклонил звонок.",
		})
	}
	return nil
}

func (h *hub) leave(c *client, id string) *failure {
	h.mu.Lock()
	current := h.calls[id]
	if current == nil || current.peers[c.peerID] != c {
		h.mu.Unlock()
		return denied
	}
	departure := h.leaveLocked(current, c)
	h.mu.Unlock()
	h.removeMedia(departure)
	return nil
}

type mediaDeparture struct {
	room string
	peer string
}

func (h *hub) removeMedia(departure mediaDeparture) {
	if err := h.media.Remove(departure.room, departure.peer); err != nil {
		log.Printf("LiveKit cleanup for room %s: %v", departure.room, err)
	}
}

func (h *hub) leaveLocked(current *call, c *client) mediaDeparture {
	if len(current.peers) == 1 {
		h.endLocked(current, "ended")
		return mediaDeparture{room: current.id}
	}
	c.cancelMedia()
	delete(current.peers, c.peerID)
	delete(h.active, c.peerID)
	if c.guest {
		c.guestCall = ""
	}
	for _, other := range current.peers {
		other.emit("call:peer_left", fields{"call_id": current.id, "peer_id": c.peerID, "media_identity": c.mediaIdentity})
	}
	c.emit("call:ended", fields{"call_id": current.id})
	h.publishChatCallLocked(current.chatID)
	return mediaDeparture{room: current.id, peer: c.mediaIdentity}
}

func (h *hub) endLocked(current *call, reason string) {
	data := fields{"call_id": current.id, "reason": reason}
	for id, session := range current.peers {
		session.cancelMedia()
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
	h.publishChatCallLocked(current.chatID)
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
	var expired []string
	for _, current := range h.calls {
		if !current.waitUntil.IsZero() && !now.Before(current.waitUntil) {
			expired = append(expired, current.id)
			h.endLocked(current, "timeout")
		}
	}
	h.mu.Unlock()
	for _, room := range expired {
		h.removeMedia(mediaDeparture{room: room})
	}
}

func (h *hub) close() {
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, current := range h.calls {
		h.endLocked(current, "ended")
	}
	for c := range h.clients {
		_ = c.conn.Close()
	}
}
