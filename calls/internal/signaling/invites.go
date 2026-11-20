package signaling

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"time"
)

var invalidInvite = &failure{"invite_invalid", "Ссылка недействительна или звонок завершён."}

type invite struct {
	id        string
	hash      [32]byte
	callID    string
	authorID  string
	expiresAt time.Time
	maxUses   int
	uses      int
}

func (entry *invite) usable(now time.Time) bool {
	return now.Before(entry.expiresAt) && entry.uses < entry.maxUses
}

func (h *hub) authorizeGuest(c *client, token string) bool {
	if len(token) != base64.RawURLEncoding.EncodedLen(32) {
		return false
	}
	digest := sha256.Sum256([]byte(token))
	h.mu.Lock()
	defer h.mu.Unlock()
	entry := h.byHash[digest]
	if entry == nil || !entry.usable(time.Now()) || h.calls[entry.callID] == nil {
		return false
	}
	c.guest, c.guestCall, c.inviteHash, c.peerID = true, entry.callID, digest, newID()
	return true
}

func (h *hub) addInvite(callID, userID string, expiresIn, maxUses int) (invite, string, bool) {
	var bytes [32]byte
	rand.Read(bytes[:])
	token := base64.RawURLEncoding.EncodeToString(bytes[:])
	entry := &invite{
		id: newID(), hash: sha256.Sum256([]byte(token)), callID: callID, authorID: userID,
		expiresAt: time.Now().Add(time.Duration(expiresIn) * time.Second).UTC(), maxUses: maxUses,
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.calls[callID] == nil {
		return invite{}, "", false
	}
	h.invites[entry.id] = entry
	h.byHash[entry.hash] = entry
	return *entry, token, true
}

func (h *hub) inviteDetails(id string) (chatID, authorID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	entry := h.invites[id]
	if entry != nil && entry.usable(time.Now()) {
		if current := h.calls[entry.callID]; current != nil {
			return current.chatID, entry.authorID
		}
	}
	return "", ""
}

func (h *hub) dropInvite(id string) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	entry := h.invites[id]
	if entry == nil || !entry.usable(time.Now()) {
		return false
	}
	h.removeInviteLocked(entry)
	return true
}

func (h *hub) removeInviteLocked(entry *invite) {
	delete(h.invites, entry.id)
	delete(h.byHash, entry.hash)
}
