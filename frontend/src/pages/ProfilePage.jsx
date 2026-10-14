import { useEffect, useRef, useState } from "react";
import { users } from "../api";

const TABS = [
  { id: "info", label: "Информация" },
  { id: "friends", label: "Друзья" },
  { id: "photos", label: "Фото" },
];

/* Данные для демо-режима — только для /profile-preview */
const DEMO_USER = {
  id: "demo-user",
  username: "chel",
  email: "john@example.com",
  avatar_url: null,
  created_at: "2026-10-03T09:21:00Z",
};

export default function ProfilePage({ demo = false }) {
  const [me, setMe] = useState(null);
  const [form, setForm] = useState({ username: "", email: "" });
  const [loading, setLoading] = useState(!demo);
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [tab, setTab] = useState("info");
  const [editMode, setEditMode] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const fileInputRef = useRef(null);

  useEffect(() => {
    users
      .getMe()
      .then((data) => {
        setMe(data); // данные уже нормализованы в users.js
        setForm({ username: data.username || "", email: data.email || "" });
      })
      .catch((e) =>
        setError(e.response?.data?.detail || "Не удалось загрузить профиль"),
      )
      .finally(() => setLoading(false));
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
    if (form.email && form.email !== me.email) patch.email = form.email.trim();

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
    setForm({ username: me.username || "", email: me.email || "" });
    setEditMode(false);
    setError(null);
  };

  const pickAvatar = () => fileInputRef.current?.click();

  const handleAvatarChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setError("Можно загрузить только изображение");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Файл слишком большой (максимум 5 МБ)");
      return;
    }

    setError(null);
    setSuccess(null);
    setUploadingAvatar(true);

    try {
      const { avatar_url, avatar_url_raw } = await users.uploadAvatar(file);
      setMe((prev) => ({
        ...prev,
        avatar_url,
        avatar_url_raw,
      }));
      setSuccess("Аватар обновлён");
    } catch (err) {
      const detail = err.response?.data?.detail;
      setError(
        typeof detail === "string" ? detail : "Не удалось загрузить аватар",
      );
    } finally {
      setUploadingAvatar(false);
      e.target.value = "";
    }
  };
  const handleDeleteAvatar = async () => {
    if (!me?.avatar_url) {
      console.warn("[DELETE] нет avatar_url в стейте");
      return;
    }

    const urlToSend = me.avatar_url_raw || me.avatar_url;
    console.log("[DELETE] Отправляю:", urlToSend);

    setError(null);
    setSuccess(null);
    setUploadingAvatar(true);

    try {
      const res = await users.deleteAvatar(urlToSend);
      console.log("[DELETE] Успех:", res);

      setMe((prev) => ({
        ...prev,
        avatar_url: null,
        avatar_url_raw: null,
      }));
      setSuccess("Аватар удалён");
    } catch (err) {
      console.error("[DELETE] Ошибка:", err);
      const detail = err.response?.data?.detail;
      let msg = "Не удалось удалить аватар";
      if (typeof detail === "string") msg = detail;
      else if (Array.isArray(detail) && detail[0]?.msg) msg = detail[0].msg;
      setError(msg);
    } finally {
      setUploadingAvatar(false);
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
            <button
              type="button"
              className="vk-avatar"
              onClick={pickAvatar}
              disabled={uploadingAvatar}
              title="Сменить аватар"
            >
              {me.avatar_url ? (
                <img
                  src={me.avatar_url}
                  alt="Аватар"
                  className="vk-avatar__img"
                />
              ) : (
                <span className="vk-avatar__placeholder">{initial}</span>
              )}
              <span className="vk-avatar__overlay">
                {uploadingAvatar ? "…" : "Сменить"}
              </span>
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleAvatarChange}
              style={{ display: "none" }}
            />

            <div className="vk-profile__identity">
              <h1 className="vk-profile__name">{me.username}</h1>
              <p className="vk-profile__status">@{me.username} · Spark</p>
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
              {me.avatar_url && (
                <button
                  type="button"
                  className="vk-btn"
                  onClick={() => setConfirmDeleteOpen(true)}
                >
                  Удалить аватар
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
                    <span className="vk-field__label">Email</span>
                    <input
                      type="email"
                      value={form.email}
                      onChange={update("email")}
                      autoComplete="email"
                    />
                  </label>
                </form>
              )}
            </>
          )}

          {tab === "friends" && (
            <p className="vk-empty">
              Пока никого нет — пригласите друзей в Spark.
            </p>
          )}

          {tab === "photos" && (
            <p className="vk-empty">Фотографии появятся здесь позже.</p>
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
