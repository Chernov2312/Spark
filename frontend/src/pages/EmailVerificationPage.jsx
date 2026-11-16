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
    let redirectTimer;

    async function verify() {
      try {
        await auth.verifyEmailToken(token);
        if (cancelled) return;

        setStatus("success");
        redirectTimer = setTimeout(
          () => navigate("/chats", { replace: true }),
          2800,
        );
      } catch (err) {
        if (cancelled) return;
        setStatus("error");
        setError(
          err.response?.status === 401
            ? "\u0421\u0441\u044b\u043b\u043a\u0430 \u043d\u0435\u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0442\u0435\u043b\u044c\u043d\u0430 \u0438\u043b\u0438 \u0441\u0440\u043e\u043a \u0435\u0451 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044f \u0438\u0441\u0442\u0451\u043a. \u0415\u0441\u043b\u0438 \u0432\u044b \u0443\u0436\u0435 \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u043b\u0438 \u043f\u043e\u0447\u0442\u0443, \u043f\u0440\u043e\u0441\u0442\u043e \u0432\u043e\u0439\u0434\u0438\u0442\u0435 \u0432 \u0430\u043a\u043a\u0430\u0443\u043d\u0442."
            : err.response?.data?.detail ||
              err.message ||
              "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u044c \u043f\u043e\u0447\u0442\u0443. \u041f\u0440\u043e\u0432\u0435\u0440\u044c\u0442\u0435 \u0441\u043e\u0435\u0434\u0438\u043d\u0435\u043d\u0438\u0435 \u0438 \u043f\u043e\u043f\u0440\u043e\u0431\u0443\u0439\u0442\u0435 \u0435\u0449\u0451 \u0440\u0430\u0437.",
        );
      }
    }

    verify();

    return () => {
      cancelled = true;
      clearTimeout(redirectTimer);
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
            <div className="verification-card__actions">
              <button
                type="button"
                className="verification-button"
                onClick={() => navigate("/chats", { replace: true })}
              >
                {"\u041e\u0442\u043a\u0440\u044b\u0442\u044c Spark"}
                <span aria-hidden="true">{"\u2192"}</span>
              </button>
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
