import { useState } from "react";
import { registerUser } from "../api/auth";

export default function RegisterForm({ onSuccess }) {
  const [form, setForm] = useState({
    lastName: "",
    firstName: "",
    middleName: "",
    noMiddleName: false,
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

    const name = [
      form.lastName.trim(),
      form.firstName.trim(),
      form.noMiddleName ? "" : form.middleName.trim(),
    ]
      .filter(Boolean)
      .join(" ");

    setLoading(true);
    try {
      const data = await registerUser({
        email: form.email,
        password: form.password,
        name,
      });
      localStorage.setItem("token", data.token);
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
        <h1 className="register-card__title">Регистрация участника</h1>

        <label className="field">
          <span className="field__label">
            Фамилия <b>*</b>
          </span>
          <input
            type="text"
            value={form.lastName}
            onChange={update("lastName")}
            required
            autoComplete="family-name"
          />
        </label>

        <label className="field">
          <span className="field__label">
            Имя <b>*</b>
          </span>
          <input
            type="text"
            value={form.firstName}
            onChange={update("firstName")}
            required
            autoComplete="given-name"
          />
        </label>

        <label className="field">
          <span className="field__label">
            Отчество (если есть) <b>*</b>
          </span>
          <input
            type="text"
            value={form.middleName}
            onChange={update("middleName")}
            disabled={form.noMiddleName}
            autoComplete="additional-name"
          />
        </label>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={form.noMiddleName}
            onChange={update("noMiddleName")}
          />
          <span>У меня нет отчества</span>
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
            Устанавливая галочку внутри данной формы, Вы даете согласие на
            обработку своих персональных данных. <a href="#">Подробнее…</a>
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
