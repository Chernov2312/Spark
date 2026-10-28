import { useState } from "react";
import { auth, translateApiError } from "../api";

export default function RegisterForm({ onSuccess, demo = false }) {
  const [form, setForm] = useState({
    username: "",
    email: "",
    password: "",
    passwordRepeat: "",
    consent: false,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const update = (field) => (e) => {
    const value =
      e.target.type === "checkbox" ? e.target.checked : e.target.value;
    setForm((p) => ({ ...p, [field]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    // Валидация на клиенте
    if (!form.username.trim()) {
      setError("Введите имя пользователя");
      return;
    }
    if (form.username.trim().length < 3) {
      setError("Имя пользователя — минимум 3 символа");
      return;
    }
    if (!form.email.trim()) {
      setError("Введите email");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      setError("Некорректный email");
      return;
    }
    if (!form.password) {
      setError("Введите пароль");
      return;
    }
    if (form.password.length < 8) {
      setError("Пароль должен содержать минимум 8 символов");
      return;
    }
    if (
      !/[a-z]/.test(form.password) ||
      !/[A-Z]/.test(form.password) ||
      !/\d/.test(form.password)
    ) {
      setError("Добавьте в пароль строчную и заглавную буквы и цифру");
      return;
    }
    if (form.password !== form.passwordRepeat) {
      setError("Пароли не совпадают");
      return;
    }
    if (!form.consent) {
      setError("Нужно согласие на обработку персональных данных");
      return;
    }

    setLoading(true);

    try {
      let data;

      if (demo) {
        await new Promise((r) => setTimeout(r, 500));
        data = {
          id: "demo-user",
          username: form.username.trim(),
          email: form.email.trim(),
          access_token: "demo-token",
          token_type: "bearer",
        };
        localStorage.setItem("access_token", data.access_token);
        localStorage.setItem(
          "user",
          JSON.stringify({
            id: data.id,
            username: data.username,
            email: data.email,
          }),
        );
      } else {
        data = await auth.registerUser({
          username: form.username.trim(),
          email: form.email.trim(),
          password: form.password,
        });
      }

      if (!data.access_token) {
        setSuccess(
          "Аккаунт создан. Перейдите по ссылке из письма, чтобы подтвердить email и войти.",
        );
        return;
      }

      onSuccess?.(data);
    } catch (err) {
      setError(translateApiError(err, "Не удалось зарегистрироваться"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="register-page">
      {demo && (
        <div className="profile-demo-banner">
          Демо-режим — аккаунт создаётся только в этом браузере
        </div>
      )}

      <form className="register-card" onSubmit={handleSubmit} noValidate>
        <h1 className="register-card__title">Создать аккаунт Spark</h1>
        <p className="register-card__subtitle">Займёт меньше минуты</p>

        <label className="field">
          <span className="field__label">
            Имя пользователя <b>*</b>
          </span>
          <input
            type="text"
            value={form.username}
            onChange={update("username")}
            required
            minLength={3}
            autoComplete="username"
            placeholder="chel"
          />
        </label>

        <label className="field">
          <span className="field__label">
            Электронная почта <b>*</b>
          </span>
          <input
            type="email"
            value={form.email}
            onChange={update("email")}
            required
            autoComplete="email"
            placeholder="john@example.com"
          />
        </label>

        <label className="field">
          <span className="field__label">
            Пароль <b>*</b>
          </span>
          <input
            type="password"
            value={form.password}
            onChange={update("password")}
            required
            minLength={8}
            maxLength={250}
            autoComplete="new-password"
            placeholder="Минимум 8 символов, заглавная и строчная буквы, цифра"
          />
        </label>

        <label className="field">
          <span className="field__label">
            Пароль ещё раз <b>*</b>
          </span>
          <input
            type="password"
            value={form.passwordRepeat}
            onChange={update("passwordRepeat")}
            required
            minLength={8}
            autoComplete="new-password"
          />
        </label>

        <label className="checkbox checkbox--consent">
          <input
            type="checkbox"
            checked={form.consent}
            onChange={update("consent")}
          />
          <span>
            Устанавливая галочку, Вы даете согласие на обработку персональных
            данных. <a href="#">Подробнее…</a>
          </span>
        </label>

        {error && <p className="register-card__error">{error}</p>}
        {success && <p role="status">{success}</p>}

        <div className="register-card__actions">
          <button type="submit" className="submit-btn" disabled={loading}>
            {loading ? "Отправка…" : "Регистрация"}
          </button>
        </div>
      </form>
    </div>
  );
}
