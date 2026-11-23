package signaling

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"spark/calls/internal/sparkapi"
)

func (s *server) requestUser(w http.ResponseWriter, r *http.Request) (sparkapi.Person, string, bool) {
	scheme, token, ok := strings.Cut(r.Header.Get("Authorization"), " ")
	if !ok || !strings.EqualFold(scheme, "Bearer") || token == "" || len(token) > 8192 {
		writeJSON(w, http.StatusUnauthorized, fields{"code": "unauthorized", "message": "Войдите в Spark."})
		return sparkapi.Person{}, "", false
	}
	user, err := s.python.Identity(r.Context(), token)
	if err != nil {
		status := http.StatusBadGateway
		if errors.Is(err, sparkapi.ErrDenied) {
			status = http.StatusUnauthorized
		}
		problem := apiFailure(err)
		writeJSON(w, status, fields{"code": problem.code, "message": problem.message})
		return sparkapi.Person{}, "", false
	}
	return user, token, true
}

func (s *server) requestMember(w http.ResponseWriter, r *http.Request, chatID, token, userID string) (sparkapi.Person, bool) {
	_, member, err := s.python.Members(r.Context(), chatID, token, userID)
	if err != nil {
		status := http.StatusBadGateway
		if errors.Is(err, sparkapi.ErrDenied) {
			status = http.StatusForbidden
		}
		problem := apiFailure(err)
		writeJSON(w, status, fields{"code": problem.code, "message": problem.message})
		return sparkapi.Person{}, false
	}
	return member, true
}

func (s *server) createInvite(w http.ResponseWriter, r *http.Request) {
	user, token, ok := s.requestUser(w, r)
	if !ok {
		return
	}
	callID := r.PathValue("call_id")
	chatID, creatorID, exists := s.hub.callInfo(callID)
	if !exists {
		writeJSON(w, http.StatusNotFound, fields{"code": unavailable.code, "message": unavailable.message})
		return
	}
	canInvite := user.ID == creatorID
	if chatID != "" {
		member, ok := s.requestMember(w, r, chatID, token, user.ID)
		if !ok {
			return
		}
		canInvite = member.Role == "owner" || member.Role == "moderator"
	}
	if !canInvite {
		writeJSON(w, http.StatusForbidden, fields{"code": denied.code, "message": denied.message})
		return
	}
	options := struct {
		ExpiresIn int  `json:"expires_in_seconds"` // Accepted for compatibility with existing clients.
		MaxUses   *int `json:"max_uses"`
	}{}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	decoder.DisallowUnknownFields()
	err := decoder.Decode(&options)
	if err == nil && decoder.Decode(new(any)) != io.EOF {
		err = errors.New("unexpected content")
	}
	if (err != nil && err != io.EOF) || (options.MaxUses != nil && (*options.MaxUses < 1 || *options.MaxUses > 20)) {
		writeJSON(w, http.StatusBadRequest, fields{"code": "invalid_invite_options", "message": "Некорректные параметры приглашения."})
		return
	}
	maxUses := 0
	if options.MaxUses != nil {
		maxUses = *options.MaxUses
	}
	entry, guestToken, ok := s.hub.addInvite(callID, user.ID, maxUses)
	if !ok {
		writeJSON(w, http.StatusNotFound, fields{"code": unavailable.code, "message": unavailable.message})
		return
	}
	result := fields{
		"invite_id": entry.id, "invite_url": s.cfg.FrontendURL + "/call/join#invite=" + guestToken,
	}
	if maxUses > 0 {
		result["max_uses"] = maxUses
	}
	writeJSON(w, http.StatusCreated, result)
}

func (s *server) revokeInvite(w http.ResponseWriter, r *http.Request) {
	user, token, ok := s.requestUser(w, r)
	if !ok {
		return
	}
	id := r.PathValue("invite_id")
	chatID, authorID, exists := s.hub.inviteDetails(id)
	if !exists {
		writeJSON(w, http.StatusNotFound, fields{"code": invalidInvite.code, "message": invalidInvite.message})
		return
	}
	canRevoke := user.ID == authorID
	if chatID != "" {
		member, ok := s.requestMember(w, r, chatID, token, user.ID)
		if !ok {
			return
		}
		canRevoke = canRevoke || member.Role == "owner" || member.Role == "moderator"
	}
	if !canRevoke {
		writeJSON(w, http.StatusForbidden, fields{"code": denied.code, "message": denied.message})
		return
	}
	if !s.hub.dropInvite(id) {
		writeJSON(w, http.StatusNotFound, fields{"code": invalidInvite.code, "message": invalidInvite.message})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
