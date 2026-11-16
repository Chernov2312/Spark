import { useState } from "react";
import { Link } from "react-router-dom";
import { auth, translateApiError } from "../api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      await auth.requestPasswordReset(email.trim());
      setSent(true);
    } catch (requestError) {
      setError(translateApiError(requestError, "Не удалось отправить письмо. Попробуйте позже."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="register-page">
      <section className="register-card">
        <h1 className="register-card__title">Восстановление пароля</h1>
        {sent ? (
          <div role="status" className="password-reset-result">
            <p>Если аккаунт с таким адресом существует, мы отправили ссылку для сброса пароля.</p>
            <p>Проверьте почту и папку «Спам».</p>
          </div>
        ) : (
          <>
            <p className="register-card__subtitle">Укажите email, привязанный к аккаунту Spark.</p>
            <form onSubmit={handleSubmit} noValidate>
              <label className="field">
                <span className="field__label">Email <b>*</b></span>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  required
                  maxLength={100}
                  disabled={loading}
                />
              </label>
              {error && <p className="register-card__error" role="alert">{error}</p>}
              <div className="register-card__actions">
                <button className="submit-btn" type="submit" disabled={loading || !email.trim()}>
                  {loading ? "Отправляем…" : "Отправить ссылку"}
                </button>
              </div>
            </form>
          </>
        )}
        <p className="password-reset-back"><Link to="/login">Вернуться ко входу</Link></p>
      </section>
    </main>
  );
}
