import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { auth, translateApiError } from "../api";

export default function ResetPasswordPage() {
  const { token } = useParams();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [loading, setLoading] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    if (password !== confirmation) {
      setError("Пароли не совпадают.");
      return;
    }
    if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}/.test(password)) {
      setError("Пароль должен содержать минимум 8 символов, заглавную и строчную буквы и цифру.");
      return;
    }
    setLoading(true);
    try {
      await auth.resetPassword(token, password);
      setComplete(true);
    } catch (requestError) {
      setError(requestError.response?.status === 400
        ? "Ссылка недействительна или срок её действия истёк. Запросите новую ссылку."
        : translateApiError(requestError, "Не удалось сохранить пароль. Попробуйте ещё раз."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="register-page">
      <section className="register-card">
        <h1 className="register-card__title">Новый пароль</h1>
        {complete ? (
          <div role="status" className="password-reset-result">
            <p>Пароль изменён. Теперь можно войти с новым паролем.</p>
            <Link className="submit-btn" to="/login">Перейти ко входу</Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate>
            <p className="register-card__subtitle">Придумайте надёжный пароль для аккаунта Spark.</p>
            <label className="field">
              <span className="field__label">Новый пароль <b>*</b></span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                required
                minLength={8}
                maxLength={250}
                disabled={loading}
              />
            </label>
            <label className="field">
              <span className="field__label">Повторите пароль <b>*</b></span>
              <input
                type="password"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete="new-password"
                required
                maxLength={250}
                disabled={loading}
              />
            </label>
            {error && <p className="register-card__error" role="alert">{error}</p>}
            <div className="register-card__actions">
              <button className="submit-btn" type="submit" disabled={loading || !password || !confirmation}>
                {loading ? "Сохраняем…" : "Сохранить пароль"}
              </button>
            </div>
          </form>
        )}
        {!complete && <p className="password-reset-back"><Link to="/login">Вернуться ко входу</Link></p>}
      </section>
    </main>
  );
}
