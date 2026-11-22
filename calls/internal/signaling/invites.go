package signaling

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"time"
)

var invalidInvite = &failure{"invite_invalid", "Ссылка недействительна или звонок завершён."}

type invite struct {
	id       string
	hash     [32]byte
	callID   string
	authorID string
	usesLeft int
}

func (h *hub) authorizeGuest(c *client, token string) bool {
	if len(token) != base64.RawURLEncoding.EncodedLen(32) {
		return false
	}
	digest := sha256.Sum256([]byte(token))
	h.mu.Lock()
	defer h.mu.Unlock()
	entry := h.byHash[digest]
	if entry == nil || h.calls[entry.callID] == nil {
		return false
	}
	c.guest, c.guestCall, c.inviteHash, c.peerID = true, entry.callID, digest, newID()
	return true
}

func (h *hub) addInvite(callID, userID string, maxUses int) (invite, string, bool) {
	var bytes [32]byte
	rand.Read(bytes[:])
	token := base64.RawURLEncoding.EncodeToString(bytes[:])
	entry := &invite{
		id: newID(), hash: sha256.Sum256([]byte(token)), callID: callID, authorID: userID,
		usesLeft: maxUses,
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	current := h.calls[callID]
	if current == nil {
		return invite{}, "", false
	}
	h.invites[entry.id] = entry
	h.byHash[entry.hash] = entry
	current.waitUntil = time.Time{}
	return *entry, token, true
}

func (h *hub) inviteDetails(id string) (chatID, authorID string, exists bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	entry := h.invites[id]
	if entry != nil {
		if current := h.calls[entry.callID]; current != nil {
			return current.chatID, entry.authorID, true
		}
	}
	return "", "", false
}

func (h *hub) dropInvite(id string) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	entry := h.invites[id]
	if entry == nil {
		return false
	}
	h.removeInviteLocked(entry)
	return true
}

func (h *hub) removeInviteLocked(entry *invite) {
	delete(h.invites, entry.id)
	delete(h.byHash, entry.hash)
}
