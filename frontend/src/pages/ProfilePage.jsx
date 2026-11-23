import { useEffect, useRef, useState } from "react";
import { social, users } from "../api";
import { getAvatarImageError } from "../api/imageUpload";

const TABS = [
  { id: "info", label: "Информация" },
  { id: "friends", label: "Друзья" },
  { id: "photos", label: "Фото" },
];

/* Данные для демо-режима — только для /profile-preview */
const DEMO_USER = {
  id: "demo-user",
  username: "chel",
  tag: "chel",
  email: "john@example.com",
  bio: "",
  birth_date: null,
  avatar_url: null,
  created_at: "2026-10-03T09:21:00Z",
};

export default function ProfilePage({ demo = false }) {
  const [me, setMe] = useState(demo ? DEMO_USER : null);
  const [form, setForm] = useState(() => ({
    username: demo ? DEMO_USER.username : "",
    tag: demo ? DEMO_USER.tag || "" : "",
    email: demo ? DEMO_USER.email : "",
    bio: demo ? DEMO_USER.bio : "",
    birth_date: demo ? "" : "",
  }));
  const [loading, setLoading] = useState(!demo);
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [tab, setTab] = useState("info");
  const [editMode, setEditMode] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [confirmDeleteIndex, setConfirmDeleteIndex] = useState(null);
  const [activeAvatarIndex, setActiveAvatarIndex] = useState(0);
  const [friends, setFriends] = useState([]);
  const [friendsLoading, setFriendsLoading] = useState(!demo);
  const [friendActionId, setFriendActionId] = useState(null);

  const fileInputRef = useRef(null);

  useEffect(() => {
    if (demo) return;

    users
      .getMe()
      .then((data) => {
        setMe(data); // данные уже нормализованы в users.js
        setActiveAvatarIndex(Math.max(0, (data.avatars?.length ?? 1) - 1));
        setForm({ username: data.username || "", tag: data.tag || "", email: data.email || "", bio: data.bio || "", birth_date: data.birth_date || "" });
      })
      .catch((e) =>
        setError(e.response?.data?.detail || "Не удалось загрузить профиль"),
      )
      .finally(() => setLoading(false));
  }, [demo]);

  useEffect(() => {
    if (demo) return;
    let cancelled = false;
    social.listFriends()
      .then((data) => { if (!cancelled) setFriends(data.friends); })
      .catch(() => { if (!cancelled) setError("Не удалось загрузить список друзей"); })
      .finally(() => { if (!cancelled) setFriendsLoading(false); });
    return () => { cancelled = true; };
  }, [demo]);

  const update = (field) => (e) =>
    setForm((p) => ({ ...p, [field]: e.target.value }));

  const handleSave = async (e) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const patch = {};
    if (form.username && form.username !== me.username)
      patch.username = form.username.trim();
    if (form.tag && form.tag !== me.tag) patch.tag = form.tag.trim();
    if (form.email && form.email !== me.email) patch.email = form.email.trim();
    if (form.bio !== (me.bio || "")) patch.bio = form.bio.trim() || null;
    if (form.birth_date !== (me.birth_date || "")) patch.birth_date = form.birth_date || null;

    if (Object.keys(patch).length === 0) {
      setSuccess("Нет изменений");
      setEditMode(false);
      return;
    }

    // Демо: обновляем только локальный стейт
    if (demo) {
      setMe((prev) => ({ ...prev, ...patch }));
      setSuccess("Профиль обновлён (демо)");
      setEditMode(false);
      return;
    }

    setSaving(true);
    try {
      const updated = await users.updateMe(patch);
      setMe((prev) => ({ ...prev, ...updated }));
      setSuccess("Профиль обновлён");
      setEditMode(false);
    } catch (err) {
      const detail = err.response?.data?.detail;
      let msg = "Не удалось сохранить";
      if (typeof detail === "string") msg = detail;
      else if (Array.isArray(detail) && detail[0]?.msg) msg = detail[0].msg;
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setForm({ username: me.username || "", tag: me.tag || "", email: me.email || "", bio: me.bio || "", birth_date: me.birth_date || "" });
    setEditMode(false);
    setError(null);
  };

  const handleRemoveFriend = async (friend) => {
    if (!window.confirm(`Удалить ${friend.username} из друзей?`)) return;
    setError(null);
    setFriendActionId(friend.id);
    try {
      await social.removeFriend(friend.id);
      setFriends((current) => current.filter((item) => item.id !== friend.id));
    } catch (err) {
      setError(err.response?.data?.detail || "Не удалось удалить друга");
    } finally {
      setFriendActionId(null);
    }
  };

  const pickAvatar = () => fileInputRef.current?.click();

  const handleAvatarChange = async (e) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    const invalidFile = files.find((file) => getAvatarImageError(file));
    if (invalidFile) {
      setError(getAvatarImageError(invalidFile));
      e.target.value = "";
      return;
    }

    setError(null);
    setSuccess(null);
    setUploadingAvatar(true);

    const uploadedAvatars = [];
    let uploadError = null;

    try {
      for (const file of files) {
        try {
          const uploaded = await users.uploadAvatar(file);
          uploadedAvatars.push({
            url: uploaded.avatar_url,
            file_key: uploaded.avatar_file_key,
          });
        } catch (err) {
          uploadError = err;
          break;
        }
      }

      if (uploadedAvatars.length > 0) {
        const firstNewIndex = me.avatars?.length ?? 0;
        setMe((prev) => {
          const avatars = [...(prev.avatars ?? []), ...uploadedAvatars];
          return {
            ...prev,
            avatars,
            avatar_urls: avatars.map((avatar) => avatar.url),
            avatar_url: avatars.at(-1)?.url ?? null,
            avatar_file_key: avatars.at(-1)?.file_key ?? null,
          };
        });
        setActiveAvatarIndex(firstNewIndex + uploadedAvatars.length - 1);
      }

      if (uploadError) {
        setError(uploadError.message || "Не удалось загрузить фото");
      } else {
        setSuccess(`Добавлено фотографий: ${uploadedAvatars.length}`);
      }
    } finally {
      setUploadingAvatar(false);
      e.target.value = "";
    }
  };

  const handleDeleteAvatar = async () => {
    const avatar = me?.avatars?.[confirmDeleteIndex];
    if (!avatar) return;

    const fileKey = avatar.file_key;
    if (!fileKey) {
      setError("Не удалось определить ключ фотографии для удаления");
      setConfirmDeleteOpen(false);
      return;
    }

    setError(null);
    setSuccess(null);
    setUploadingAvatar(true);

    try {
      await users.deleteAvatar(fileKey);

      const remainingAvatars = me.avatars.filter((item) => item.file_key !== fileKey);
      setMe((prev) => ({
        ...prev,
        avatars: remainingAvatars,
        avatar_urls: remainingAvatars.map((item) => item.url),
        avatar_url: remainingAvatars.at(-1)?.url ?? null,
        avatar_file_key: remainingAvatars.at(-1)?.file_key ?? null,
      }));
      setActiveAvatarIndex((current) =>
        Math.max(0, Math.min(current, remainingAvatars.length - 1)),
      );
      setSuccess("Фотография удалена");
    } catch (err) {
      const detail = err.response?.data?.detail;
      let msg = "Не удалось удалить фотографию";
      if (typeof detail === "string") msg = detail;
      else if (Array.isArray(detail) && detail[0]?.msg) msg = detail[0].msg;
      else if (err.message) msg = err.message;
      setError(msg);
    } finally {
      setUploadingAvatar(false);
      setConfirmDeleteOpen(false);
    }
  };

  if (loading) {
    return (
      <main className="profile-page">
        <p className="profile-page__hint">Загрузка…</p>
      </main>
    );
  }

  if (!me) {
    return (
      <main className="profile-page">
        <p className="register-card__error">{error || "Профиль не найден"}</p>
      </main>
    );
  }

  const initial = me.username?.[0]?.toUpperCase() || "?";
  const avatars = me.avatars ?? (me.avatar_url
    ? [{ url: me.avatar_url, file_key: me.avatar_file_key }]
    : []);
  const currentAvatarIndex = avatars.length
    ? Math.min(activeAvatarIndex, avatars.length - 1)
    : 0;
  const currentAvatar = avatars[currentAvatarIndex] ?? null;
  const memberSince = me.created_at
    ? new Date(me.created_at).toLocaleDateString("ru-RU", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "—";

  return (
    <main className="profile-page">
      {demo && (
        <div className="profile-demo-banner">
          Демо-режим — данные не сохраняются на сервере
        </div>
      )}

      <div className="vk-profile">
        <div className="vk-profile__cover">
          <div className="vk-profile__cover-gradient" />

          <div className="vk-profile__header">
            <div className="vk-avatar-carousel">
              <div className="vk-avatar-carousel__stage">
                <button
                  type="button"
                  className="vk-avatar"
                  onClick={() => setTab("photos")}
                  title="Открыть фотографии профиля"
                  aria-label="Открыть фотографии профиля"
                >
                  {currentAvatar ? (
                    <img
                      src={currentAvatar.url}
                      alt={`Фото профиля ${currentAvatarIndex + 1}`}
                      className="vk-avatar__img"
                    />
                  ) : (
                    <span className="vk-avatar__placeholder">{initial}</span>
                  )}
                  <span className="vk-avatar__overlay">
                    {avatars.length > 1
                      ? `${currentAvatarIndex + 1} / ${avatars.length} · Смотреть`
                      : "Смотреть фото"}
                  </span>
                </button>

                {avatars.length > 1 && (
                  <>
                    <button
                      type="button"
                      className="vk-avatar-carousel__arrow vk-avatar-carousel__arrow--previous"
                      aria-label="Предыдущее фото"
                      onClick={() => setActiveAvatarIndex((index) => (index - 1 + avatars.length) % avatars.length)}
                    >
                      ‹
                    </button>
                    <button
                      type="button"
                      className="vk-avatar-carousel__arrow vk-avatar-carousel__arrow--next"
                      aria-label="Следующее фото"
                      onClick={() => setActiveAvatarIndex((index) => (index + 1) % avatars.length)}
                    >
                      ›
                    </button>
                  </>
                )}

                <button
                  type="button"
                  className="vk-avatar__add"
                  onClick={pickAvatar}
                  disabled={uploadingAvatar}
                  aria-label="Добавить фотографии"
                  title="Добавить фотографии"
                >
                  +
                </button>
              </div>

              {avatars.length > 1 && (
                <div className="vk-avatar-carousel__indicators" aria-label="Выбор фотографии">
                  {avatars.map((avatar, index) => (
                    <button
                      key={avatar.file_key ?? `${avatar.url}-${index}`}
                      type="button"
                      className={`vk-avatar-carousel__indicator${index === currentAvatarIndex ? " vk-avatar-carousel__indicator--active" : ""}`}
                      aria-label={`Показать фото ${index + 1}`}
                      aria-pressed={index === currentAvatarIndex}
                      onClick={() => setActiveAvatarIndex(index)}
                    />
                  ))}
                </div>
              )}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              multiple
              onChange={handleAvatarChange}
              style={{ display: "none" }}
            />
            <div className="vk-profile__identity">
              <h1 className="vk-profile__name">{me.username}</h1>
              <p className="vk-profile__status">@{me.tag} · Spark</p>
            </div>
          </div>
        </div>

        <div className="vk-profile__actions">
          {!editMode ? (
            <>
              <button
                type="button"
                className="vk-btn vk-btn--primary"
                onClick={() => setEditMode(true)}
              >
                Редактировать профиль
              </button>
              {avatars.length > 0 && (
                <button
                  type="button"
                  className="vk-btn"
                  onClick={() => {
                    setConfirmDeleteIndex(currentAvatarIndex);
                    setConfirmDeleteOpen(true);
                  }}
                >
                  Удалить фото
                </button>
              )}
            </>
          ) : (
            <>
              <button
                type="button"
                className="vk-btn vk-btn--primary"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? "Сохранение…" : "Сохранить"}
              </button>
              <button
                type="button"
                className="vk-btn"
                onClick={handleCancelEdit}
                disabled={saving}
              >
                Отмена
              </button>
            </>
          )}
        </div>

        <div className="vk-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`vk-tab ${tab === t.id ? "vk-tab--active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="vk-tab-content" key={tab}>
          {tab === "info" && (
            <>
              {error && <p className="register-card__error">{error}</p>}
              {success && <p className="profile-form__success">{success}</p>}

              {!editMode ? (
                <ul className="vk-info-list">
                  <li className="vk-info-row">
                    <span className="vk-info-row__label">Имя пользователя</span>
                    <span className="vk-info-row__value">{me.username}</span>
                  </li>
                  <li className="vk-info-row">
                    <span className="vk-info-row__label">Email</span>
                    <span className="vk-info-row__value">{me.email}</span>
                  </li>
                  <li className="vk-info-row">
                    <span className="vk-info-row__label">О себе</span>
                    <span className="vk-info-row__value">{me.bio || "Не указано"}</span>
                  </li>
                  <li className="vk-info-row">
                    <span className="vk-info-row__label">Дата рождения</span>
                    <span className="vk-info-row__value">{me.birth_date ? new Date(`${me.birth_date}T00:00:00`).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" }) : "Дата рождения не установлена"}</span>
                  </li>
                  <li className="vk-info-row">
                    <span className="vk-info-row__label">Тег пользователя</span>
                    <span className="vk-info-row__value">@{me.tag}</span>
                  </li>
                  <li className="vk-info-row">
                    <span className="vk-info-row__label">С нами с</span>
                    <span className="vk-info-row__value">{memberSince}</span>
                  </li>
                </ul>
              ) : (
                <form onSubmit={handleSave} noValidate>
                  <label className="vk-field">
                    <span className="vk-field__label">Имя пользователя</span>
                    <input
                      type="text"
                      value={form.username}
                      onChange={update("username")}
                      minLength={3}
                      maxLength={32}
                      autoComplete="username"
                    />
                  </label>

                  <label className="vk-field">
                    <span className="vk-field__label">Уникальный тег</span>
                    <input
                      type="text"
                      value={form.tag}
                      onChange={update("tag")}
                      minLength={3}
                      maxLength={32}
                      autoComplete="off"
                      placeholder="@username"
                    />
                    <small>Тег приводится к нижнему регистру; похожие буквы считаются одинаковыми.</small>
                  </label>

                  <label className="vk-field">
                    <span className="vk-field__label">Email</span>
                    <input
                      type="email"
                      value={form.email}
                      onChange={update("email")}
                      autoComplete="email"
                    />
                  </label>
                  <label className="vk-field">
                    <span className="vk-field__label">О себе</span>
                    <textarea value={form.bio} onChange={update("bio")} maxLength={500} rows={4} placeholder="Расскажите немного о себе" />
                  </label>
                  <label className="vk-field">
                    <span className="vk-field__label">Дата рождения</span>
                    <input type="date" value={form.birth_date} onChange={update("birth_date")} />
                  </label>
                </form>
              )}
            </>
          )}

          {tab === "friends" && (
            <section className="profile-friends" aria-label="Друзья пользователя">
              {error && <p className="register-card__error" role="alert">{error}</p>}
              {friendsLoading ? <p className="vk-empty">Загрузка друзей…</p> : friends.length ? (
                <ul className="profile-friends__list">
                  {friends.map((friend) => <li className="profile-friends__item" key={friend.id}>
                    <span className="profile-friends__avatar" aria-hidden="true">{friend.username?.[0]?.toUpperCase() || "?"}</span>
                    <span className="profile-friends__identity"><strong>{friend.username}</strong><small>@{friend.tag}</small></span>
                    {!demo && <button type="button" className="vk-btn profile-friends__remove" disabled={friendActionId === friend.id} onClick={() => handleRemoveFriend(friend)}>
                      {friendActionId === friend.id ? "Удаление…" : "Удалить из друзей"}
                    </button>}
                  </li>)}
                </ul>
              ) : <p className="vk-empty">Пока нет друзей — найдите человека в разделе чатов.</p>}
            </section>
          )}

          {tab === "photos" && (
            <section className="avatar-gallery" aria-label="Фотографии профиля">
              <div className="avatar-gallery__header">
                <div>
                  <h2>Фотографии профиля</h2>
                  <p>Добавьте несколько фото и переключайтесь между ними.</p>
                </div>
                <button
                  type="button"
                  className="vk-btn vk-btn--primary"
                  onClick={pickAvatar}
                  disabled={uploadingAvatar}
                >
                  {uploadingAvatar ? "Загрузка…" : "Добавить фото"}
                </button>
              </div>

              {error && <p className="register-card__error">{error}</p>}
              {success && <p className="profile-form__success">{success}</p>}

              {avatars.length > 0 ? (
                <div className="avatar-gallery__grid">
                  {avatars.map((avatar, index) => (
                    <article
                      key={avatar.file_key ?? `${avatar.url}-${index}`}
                      className={`avatar-gallery__item${index === currentAvatarIndex ? " avatar-gallery__item--active" : ""}`}
                    >
                      <button
                        type="button"
                        className="avatar-gallery__photo"
                        onClick={() => setActiveAvatarIndex(index)}
                        aria-pressed={index === currentAvatarIndex}
                        aria-label={`Показать фото ${index + 1}`}
                      >
                        <img src={avatar.url} alt={`Фото профиля ${index + 1}`} />
                        {index === currentAvatarIndex && (
                          <span className="avatar-gallery__current">Выбрано</span>
                        )}
                      </button>
                      <button
                        type="button"
                        className="avatar-gallery__delete"
                        onClick={() => {
                          setConfirmDeleteIndex(index);
                          setConfirmDeleteOpen(true);
                        }}
                        disabled={uploadingAvatar}
                        aria-label={`Удалить фото ${index + 1}`}
                        title="Удалить фото"
                      >
                        ×
                      </button>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="vk-empty">Здесь появятся добавленные вами фотографии.</p>
              )}
            </section>
          )}
        </div>
      </div>
      {confirmDeleteOpen && (
        <div
          className="modal-backdrop"
          onClick={() => setConfirmDeleteOpen(false)}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Удалить аватар?</h3>
            <p style={{ color: "var(--text-muted)", marginBottom: 20 }}>
              Действие нельзя отменить.
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="button"
                className="vk-btn vk-btn--primary"
                onClick={() => {
                  setConfirmDeleteOpen(false);
                  handleDeleteAvatar();
                }}
              >
                Удалить
              </button>
              <button
                type="button"
                className="vk-btn"
                onClick={() => setConfirmDeleteOpen(false)}
              >
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
