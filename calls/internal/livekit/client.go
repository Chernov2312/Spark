package livekit

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type videoGrant struct {
	Room                 string   `json:"room"`
	RoomJoin             bool     `json:"roomJoin,omitempty"`
	RoomCreate           bool     `json:"roomCreate,omitempty"`
	RoomAdmin            bool     `json:"roomAdmin,omitempty"`
	CanPublish           *bool    `json:"canPublish,omitempty"`
	CanSubscribe         *bool    `json:"canSubscribe,omitempty"`
	CanPublishSources    []string `json:"canPublishSources,omitempty"`
	CanPublishData       *bool    `json:"canPublishData,omitempty"`
	CanUpdateOwnMetadata *bool    `json:"canUpdateOwnMetadata,omitempty"`
}

type claims struct {
	jwt.RegisteredClaims
	Video videoGrant `json:"video"`
}

type Client struct {
	url    *url.URL
	key    string
	secret []byte
	http   *http.Client
}

func New(serverURL *url.URL, key, secret string) Client {
	return Client{
		url: serverURL, key: key, secret: []byte(secret),
		http: &http.Client{
			Timeout:       3 * time.Second,
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		},
	}
}

func (c Client) sign(identity string, grant videoGrant, ttl time.Duration) (string, error) {
	now := time.Now()
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims{
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer: c.key, Subject: identity,
			NotBefore: jwt.NewNumericDate(now.Add(-10 * time.Second)),
			ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
		},
		Video: grant,
	}).SignedString(c.secret)
}

func (c Client) JoinToken(room, identity string) (string, error) {
	allowed := true
	disallowed := false
	return c.sign(identity, videoGrant{
		Room: room, RoomJoin: true, CanPublish: &allowed, CanSubscribe: &allowed,
		CanPublishSources: []string{"microphone", "camera", "screen_share"},
		CanPublishData:    &disallowed, CanUpdateOwnMetadata: &disallowed,
	}, 4*time.Hour)
}

func (c Client) JoinIdentity(rawToken string) (room, identity string, ok bool) {
	if len(rawToken) == 0 || len(rawToken) > 8192 {
		return "", "", false
	}
	value := new(claims)
	_, err := jwt.ParseWithClaims(rawToken, value, func(*jwt.Token) (any, error) { return c.secret, nil },
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}), jwt.WithIssuer(c.key), jwt.WithExpirationRequired())
	if err != nil || !value.Video.RoomJoin || value.Video.Room == "" || value.Subject == "" {
		return "", "", false
	}
	return value.Video.Room, value.Subject, true
}

func (c Client) Ready(ctx context.Context) bool {
	if c.url == nil {
		return false
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.url.String(), nil)
	if err != nil {
		return false
	}
	res, err := c.http.Do(req)
	if err != nil {
		return false
	}
	defer func() { _ = res.Body.Close() }()
	_, _ = io.Copy(io.Discard, io.LimitReader(res.Body, 4096))
	return res.StatusCode == http.StatusOK
}

// Remove disconnects an individual participant, or deletes the room if identity is empty.
func (c Client) Remove(room, identity string) error {
	if room == "" {
		return nil
	}
	if c.url == nil {
		return errors.New("LiveKit URL is missing")
	}
	method := "DeleteRoom"
	body := map[string]string{"room": room}
	grant := videoGrant{RoomCreate: true}
	if identity != "" {
		method = "RemoveParticipant"
		body["identity"] = identity
		grant = videoGrant{Room: room, RoomAdmin: true}
	}
	token, err := c.sign("", grant, time.Minute)
	if err != nil {
		return err
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(context.Background(), http.MethodPost,
		c.url.JoinPath("twirp", "livekit.RoomService", method).String(), bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNotFound {
		return fmt.Errorf("LiveKit %s returned HTTP %d", method, resp.StatusCode)
	}
	return nil
}
