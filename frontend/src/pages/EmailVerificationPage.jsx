import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { auth } from "../api";
import "../styles/email-verification.css";

export default function EmailVerificationPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function verify() {
      try {
        await auth.verifyEmailToken(token);
        if (cancelled) return;

        setStatus("success");
        setTimeout(() => navigate("/chats", { replace: true }), 1200);
      } catch (err) {
        if (cancelled) return;
        setStatus("error");
        setError(
          err.response?.data?.detail ||
            err.message ||
            "Не удалось подтвердить почту. Попробуйте ещё раз.",
        );
      }
    }

    verify();

    return () => {
      cancelled = true;
    };
  }, [token, navigate]);

  return (
    <main className="email-verification">
      <div className="email-verification__glow" aria-hidden="true" />
      <section
        className={`verification-card verification-card--${status}`}
        aria-live="polite"
      >
        <a className="verification-brand" href="/" aria-label="Spark — главная">
          <span className="verification-brand__mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" fill="none">
              <path
                d="M18.8 3.5 7.2 17.1h7.4l-1.4 11.4 11.6-14h-7.5l1.5-11Z"
                fill="currentColor"
              />
            </svg>
          </span>
          <span>spark</span>
        </a>

        <div className="verification-card__content">
          <div className="verification-status-icon" aria-hidden="true">
            {status === "loading" && (
              <span className="verification-spinner" />
            )}
            {status === "success" && (
              <svg viewBox="0 0 48 48" fill="none">
                <path
                  d="m14 24.5 6.5 6.5L34.5 17"
                  stroke="currentColor"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
            {status === "error" && (
              <svg viewBox="0 0 48 48" fill="none">
                <path
                  d="M24 15v11m0 7h.02M24 5.5 3.8 40.5h40.4L24 5.5Z"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </div>

          <span className="verification-eyebrow">
            {status === "error" ? "Нужно действие" : "Почта"}
          </span>
          <h1 className="verification-card__title">
            {status === "loading" && "Подтверждаем адрес"}
            {status === "success" && "Всё получилось!"}
            {status === "error" && "Не удалось подтвердить"}
          </h1>
          <p className="verification-card__description">
            {status === "loading" &&
              "Проверяем ссылку подтверждения. Это займёт всего несколько секунд."}
            {status === "success" &&
              "Ваш email подтверждён. Сейчас перенаправим вас в Spark."}
            {status === "error" &&
              (error || "Ссылка недействительна или срок её действия истёк.")}
          </p>

          {status === "loading" && (
            <div
              className="verification-progress"
              role="progressbar"
              aria-label="Подтверждение адреса электронной почты"
            >
              <span />
            </div>
          )}

          {status === "success" && (
            <div className="verification-note">
              <span className="verification-note__dot" />
              Переходим в чат…
            </div>
          )}

          {status === "error" && (
            <div className="verification-card__actions">
              <button
                type="button"
                className="verification-button"
                onClick={() => navigate("/login", { replace: true })}
              >
                Перейти ко входу
                <span aria-hidden="true">→</span>
              </button>
              <a className="verification-back-link" href="/">
                На главную
              </a>
            </div>
          )}
        </div>

        <div className="verification-card__footer">
          <span className="verification-footer-mark" aria-hidden="true">✦</span>
          Общайтесь ярче вместе со Spark
        </div>
      </section>
    </main>
  );
}
