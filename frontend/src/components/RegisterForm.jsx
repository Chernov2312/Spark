import { useState } from "react";
import { auth } from "../api";

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

  const update = (field) => (e) => {
    const value =
      e.target.type === "checkbox" ? e.target.checked : e.target.value;
    setForm((p) => ({ ...p, [field]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

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
      const data = await auth.registerUser({
        username: form.username.trim(),
        email: form.email.trim(),
        password: form.password,
      });
      onSuccess?.(data);
    } catch (err) {
      const detail = err.response?.data?.detail;
      let msg = "Ошибка регистрации";
      if (typeof detail === "string") msg = detail;
      else if (Array.isArray(detail) && detail[0]?.msg) msg = detail[0].msg;
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="register-page">
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
            minLength={6}
            autoComplete="new-password"
            placeholder="Минимум 6 символов"
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
            minLength={6}
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

        <div className="register-card__actions">
          <button type="submit" className="submit-btn" disabled={loading}>
            {loading ? "Отправка…" : "Регистрация"}
          </button>
        </div>
      </form>
    </div>
  );
}
