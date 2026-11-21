package sparkapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"regexp"
	"time"
)

var uuidPattern = regexp.MustCompile("^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$")

func ValidID(value string) bool {
	return uuidPattern.MatchString(value)
}

var ErrDenied = errors.New("access denied")

type Person struct {
	ID       string `json:"id"`
	Username string `json:"username"`
	Role     string `json:"role"`
}

type Client struct {
	base   string
	client *http.Client
}

func New(base string) Client {
	return Client{
		base: base,
		client: &http.Client{
			Timeout:       4 * time.Second,
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		},
	}
}

func (api Client) get(ctx context.Context, path, token string, output any) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, api.base+path, nil)
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Accept", "application/json")
	response, err := api.client.Do(request)
	if err != nil {
		return err
	}
	defer func() { _ = response.Body.Close() }()
	switch response.StatusCode {
	case http.StatusOK:
		return json.NewDecoder(io.LimitReader(response.Body, 4<<20)).Decode(output)
	case http.StatusUnauthorized, http.StatusForbidden, http.StatusNotFound:
		return ErrDenied
	default:
		return errors.New("python API unavailable")
	}
}

func (api Client) Identity(ctx context.Context, token string) (Person, error) {
	var user Person
	err := api.get(ctx, "/users/me", token, &user)
	if err == nil && !ValidID(user.ID) {
		err = ErrDenied
	}
	return user, err
}

func (api Client) Members(ctx context.Context, chatID, token, userID string) ([]Person, Person, error) {
	if !ValidID(chatID) {
		return nil, Person{}, ErrDenied
	}
	var members []Person
	if err := api.get(ctx, "/chats/"+chatID+"/members", token, &members); err != nil {
		return nil, Person{}, err
	}
	for _, member := range members {
		if member.ID == userID {
			return members, member, nil
		}
	}
	return nil, Person{}, ErrDenied
}
