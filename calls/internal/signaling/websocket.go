package signaling

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/gorilla/websocket"

	"spark/calls/internal/sparkapi"
)

const (
	authTimeout = 6 * time.Second
	pongTimeout = 60 * time.Second
	pingPeriod  = 25 * time.Second
	writeWait   = 5 * time.Second
)

type requestEvent struct {
	Event string      `json:"event"`
	Data  requestData `json:"data"`
}

type requestData struct {
	AccessToken string          `json:"access_token"`
	InviteToken string          `json:"invite_token"`
	ChatID      string          `json:"chat_id"`
	CallID      string          `json:"call_id"`
	TargetID    string          `json:"target_id"`
	Media       string          `json:"media"`
	SDP         json.RawMessage `json:"sdp"`
	Candidate   json.RawMessage `json:"candidate"`
}

type fields map[string]any

type event struct {
	Event string `json:"event"`
	Data  fields `json:"data"`
}

type failure struct {
	code    string
	message string
}

var (
	unavailable = &failure{"call_unavailable", "Звонок завершён или недоступен."}
	denied      = &failure{"forbidden", "Нет доступа к этому звонку."}
	busy        = &failure{"busy", "Вы уже участвуете в другом звонке."}
)

type client struct {
	conn       *websocket.Conn
	out        chan event
	done       chan struct{}
	user       sparkapi.Person
	token      string
	peerID     string
	guest      bool
	guestCall  string
	inviteHash [32]byte
}

func (c *client) emit(name string, data fields) {
	select {
	case <-c.done:
	case c.out <- event{name, data}:
	default:
		_ = c.conn.Close()
	}
}

func (s *server) websocket(w http.ResponseWriter, r *http.Request) {
	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer func() { _ = conn.Close() }()
	conn.SetReadLimit(128 << 10)
	_ = conn.SetReadDeadline(time.Now().Add(authTimeout))
	_ = conn.SetWriteDeadline(time.Now().Add(writeWait))

	var auth requestEvent
	if conn.ReadJSON(&auth) != nil {
		return
	}
	c := &client{conn: conn, out: make(chan event, 64), done: make(chan struct{})}
	claims, authError := s.authenticate(r, auth, c)
	if authError != nil {
		_ = conn.WriteJSON(event{"auth:error", fields{"code": authError.code, "message": authError.message}})
		return
	}
	claims["ice_servers"] = s.cfg.ICEServers(c.peerID)
	claims["peer_id"] = c.peerID
	s.hub.connect(c)
	defer s.hub.disconnect(c)
	defer close(c.done)
	if conn.WriteJSON(event{"auth:ok", claims}) != nil {
		return
	}
	_ = conn.SetReadDeadline(time.Now().Add(pongTimeout))
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(pongTimeout))
	})
	go c.writeMessages()
	for {
		var request requestEvent
		if conn.ReadJSON(&request) != nil {
			return
		}
		if problem := s.handle(r, c, request); problem != nil {
			c.emit("call:error", fields{
				"call_id": request.Data.CallID, "code": problem.code, "message": problem.message,
			})
		}
	}
}

func (s *server) authenticate(r *http.Request, auth requestEvent, c *client) (fields, *failure) {
	data := auth.Data
	if auth.Event != "auth" || (data.AccessToken == "") == (data.InviteToken == "") {
		return nil, &failure{"invalid_auth", "Первым сообщением отправьте данные для входа."}
	}
	if data.InviteToken != "" {
		if !s.hub.authorizeGuest(c, data.InviteToken) {
			return nil, invalidInvite
		}
		return fields{"guest": true, "call_id": c.guestCall}, nil
	}
	if len(data.AccessToken) > 8192 {
		return nil, denied
	}
	user, err := s.python.Identity(r.Context(), data.AccessToken)
	if err != nil {
		return nil, apiFailure(err)
	}
	c.token, c.user, c.peerID = data.AccessToken, user, user.ID
	return fields{"user_id": user.ID}, nil
}

func (c *client) writeMessages() {
	defer func() { _ = c.conn.Close() }()
	ticker := time.NewTicker(pingPeriod)
	defer ticker.Stop()
	for {
		select {
		case <-c.done:
			return
		case item := <-c.out:
			_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if c.conn.WriteJSON(item) != nil {
				return
			}
		case <-ticker.C:
			if c.conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(writeWait)) != nil {
				return
			}
		}
	}
}

func apiFailure(err error) *failure {
	if errors.Is(err, sparkapi.ErrDenied) {
		return denied
	}
	return &failure{"api_unavailable", "Сервис проверки доступа временно недоступен."}
}

func (s *server) handle(r *http.Request, c *client, request requestEvent) *failure {
	data := request.Data
	switch request.Event {
	case "call:start":
		if c.guest {
			return denied
		}
		if !sparkapi.ValidID(data.ChatID) || (data.Media != "audio" && data.Media != "video") {
			return &failure{"invalid_call", "Некорректные параметры звонка."}
		}
		members, _, err := s.python.Members(r.Context(), data.ChatID, c.token, c.user.ID)
		if err != nil {
			return apiFailure(err)
		}
		return s.hub.start(c, data.ChatID, data.Media, members)
	case "call:accept":
		if !c.guest {
			chatID := s.hub.chatID(data.CallID)
			if chatID == "" {
				return unavailable
			}
			if _, _, err := s.python.Members(r.Context(), chatID, c.token, c.user.ID); err != nil {
				return apiFailure(err)
			}
		}
		return s.hub.accept(c, data.CallID)
	case "call:decline":
		return s.hub.decline(c, data.CallID)
	case "call:end":
		return s.hub.leave(c, data.CallID)
	case "rtc:offer", "rtc:answer":
		var description struct {
			Type string `json:"type"`
			SDP  string `json:"sdp"`
		}
		if json.Unmarshal(data.SDP, &description) != nil ||
			description.Type != request.Event[len("rtc:"):] || description.SDP == "" {
			return &failure{"invalid_signal", "Некорректное описание WebRTC."}
		}
		return s.hub.signal(c, data.CallID, data.TargetID, request.Event, data.SDP)
	case "rtc:ice":
		var candidate struct {
			Value string `json:"candidate"`
		}
		if json.Unmarshal(data.Candidate, &candidate) != nil || candidate.Value == "" {
			return &failure{"invalid_signal", "Некорректный ICE-кандидат."}
		}
		return s.hub.signal(c, data.CallID, data.TargetID, request.Event, data.Candidate)
	default:
		return &failure{"unsupported_event", "Неизвестное событие звонка."}
	}
}
