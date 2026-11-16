import { useState } from "react";
import { auth, translateApiError } from "../api";

const TAG_TRANSLITERATION = {
  а: "a", е: "e", ё: "e", о: "o", р: "p", с: "c", у: "y", х: "x",
  к: "k", м: "m", т: "t", в: "b", н: "h", і: "i", б: "b", г: "g",
  д: "d", ж: "zh", з: "z", й: "i", л: "l", ф: "f", ц: "c", ч: "ch",
  ш: "sh", щ: "shch", ы: "y", э: "e", ю: "yu", я: "ya",
  α: "a", β: "b", ε: "e", ι: "i", κ: "k", ο: "o", ρ: "p",
  τ: "t", υ: "y", χ: "x",
};

function normalizeTag(value) {
  return Array.from(value.normalize("NFKC").toLowerCase())
    .map((character) => TAG_TRANSLITERATION[character] ?? character)
    .join("")
    .replace(/^@+/, "")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
}

export default function RegisterForm({ onSuccess, demo = false }) {
  const [form, setForm] = useState({
    username: "",
    tag: "",
    email: "",
    password: "",
    passwordRepeat: "",
    consent: false,
  });
  const [tagTouched, setTagTouched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [verificationSent, setVerificationSent] = useState(null);

  const update = (field) => (e) => {
    const value =
      e.target.type === "checkbox" ? e.target.checked : e.target.value;
    if (field === "tag") setTagTouched(true);
    setForm((p) => {
      if (field === "username") {
        return {
          ...p,
          username: value,
          ...(!tagTouched ? { tag: normalizeTag(value) } : {}),
        };
      }
      if (field === "tag") {
        return { ...p, tag: normalizeTag(value) };
      }
      return { ...p, [field]: value };
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    // Валидация на клиенте
    if (!form.username.trim()) {
      setError("Введите имя пользователя");
      return;
    }
    if (form.username.trim().length < 3) {
      setError("Имя пользователя — минимум 3 символа");
      return;
    }
    if (tagTouched && form.tag.length < 3) {
      setError("Тег должен содержать минимум 3 латинские буквы или цифры");
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
          tag: form.tag || normalizeTag(form.username) || "user",
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
            tag: data.tag,
            email: data.email,
          }),
        );
      } else {
        data = await auth.registerUser({
          username: form.username.trim(),
          tag: tagTouched ? form.tag : null,
          email: form.email.trim(),
          password: form.password,
        });
      }

      if (data.verification_required) {
        setVerificationSent({ email: data.email, tag: data.tag });
        return;
      }

      onSuccess?.(data);
    } catch (err) {
      setError(translateApiError(err, "Не удалось зарегистрироваться"));
    } finally {
      setLoading(false);
    }
  };

  if (verificationSent) {
    return (
      <div className="register-page">
        <section className="register-card register-email-sent" role="status">
          <div className="register-email-sent__icon" aria-hidden="true">
            <svg viewBox="0 0 48 48" fill="none">
              <rect x="6" y="10" width="36" height="28" rx="6" stroke="currentColor" strokeWidth="3" />
              <path d="m9 15 15 12 15-12" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <span className="register-email-sent__eyebrow">ПОЧТА ОТПРАВЛЕНА</span>
          <h1 className="register-card__title">Проверьте почту</h1>
          <p className="register-card__subtitle">
            Мы отправили ссылку для подтверждения на <strong>{verificationSent.email}</strong>.
            Откройте письмо и перейдите по ссылке, чтобы активировать аккаунт.
          </p>
          <div className="register-email-sent__tag">
            Ваш тег в Spark <strong>@{verificationSent.tag}</strong>
          </div>
          <p className="register-email-sent__hint">
            Если письма нет, проверьте папку «Спам». Ссылка действует 24 часа.
          </p>
          <a className="register-email-sent__link" href="/">
            Вернуться на главную
          </a>
        </section>
      </div>
    );
  }

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
          <span className="field__label">Уникальный тег <b>*</b></span>
          <div className="register-tag-input">
            <span aria-hidden="true">@</span>
            <input
              type="text"
              value={form.tag}
              onChange={update("tag")}
              required
              minLength={3}
              maxLength={32}
              autoComplete="off"
              placeholder="chel"
              aria-describedby="register-tag-help"
            />
          </div>
          <small id="register-tag-help">
            По тегу вас найдут, даже если у других пользователей такое же имя. Если предложенный тег занят, система добавит цифры; свой вариант можно изменить.
          </small>
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

        <div className="register-card__actions">
          <button type="submit" className="submit-btn" disabled={loading}>
            {loading ? "Отправка…" : "Регистрация"}
          </button>
        </div>
      </form>
    </div>
  );
}
