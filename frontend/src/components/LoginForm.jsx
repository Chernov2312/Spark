import { useState } from "react";
import { auth } from "../api";

export default function LoginForm({ onSuccess }) {
  const [form, setForm] = useState({ email: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const update = (field) => (e) =>
    setForm((p) => ({ ...p, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const data = await auth.loginUser({
        email: form.email.trim(),
        password: form.password,
      });
      onSuccess?.(data);
    } catch (err) {
      const detail = err.response?.data?.detail;
      let msg = "Неверный email или пароль";
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
        <h1 className="register-card__title">Вход в Spark</h1>
        <p className="register-card__subtitle">Рады видеть снова</p>

        <label className="field">
          <span className="field__label">
            Email или имя пользователя <b>*</b>
          </span>
          <input
            type="text"
            value={form.email}
            onChange={update("email")}
            required
            autoComplete="username"
            placeholder="john@example.com или chel"
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
