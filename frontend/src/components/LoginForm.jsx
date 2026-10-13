import { useState } from "react";
import { auth, translateApiError } from "../api";

export default function LoginForm({ onSuccess }) {
  const [form, setForm] = useState({ username: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const update = (field) => (e) =>
    setForm((p) => ({ ...p, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (!form.username.trim() || !form.password) {
      setError("Заполните все поля");
      return;
    }

    setLoading(true);
    try {
      const data = await auth.loginUser({
        username: form.username.trim(),
        password: form.password,
      });
      onSuccess?.(data);
    } catch (err) {
      setError(translateApiError(err, "Не удалось войти"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="register-page">
      <form className="register-card" onSubmit={handleSubmit} noValidate>
        <h1 className="register-card__title">Вход в Spark</h1>
        <p className="register-card__subtitle">Рады видеть снова</p>

        <label className="field">
          <span className="field__label">
            Имя пользователя <b>*</b>
          </span>
          <input
            type="text"
            value={form.username}
            onChange={update("username")}
            required
            autoComplete="username"
            placeholder="chel"
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
            autoComplete="current-password"
          />
        </label>

        {error && <p className="register-card__error">{error}</p>}

        <div className="register-card__actions">
          <button type="submit" className="submit-btn" disabled={loading}>
            {loading ? "Вход…" : "Войти"}
          </button>
        </div>
      </form>
    </div>
  );
}
