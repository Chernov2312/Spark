import { Link, NavLink } from "react-router-dom";
import { useContext, useEffect, useLayoutEffect, useState } from "react";
import SparkLogo from "./SparkLogo";
import { CallsContext } from "./callsContext";
import { auth, AUTH_EVENT } from "../api";

const navCls = ({ isActive }) =>
  isActive ? "nav-link nav-link--active" : "nav-link";

function getInitialTheme() {
  const savedTheme = window.localStorage.getItem("spark-theme");
  if (savedTheme === "light" || savedTheme === "dark") return savedTheme;
  return window.matchMedia?.("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

export default function Header() {
  const [user, setUser] = useState(auth.getCurrentUser());
  const [theme, setTheme] = useState(getInitialTheme);
  const calls = useContext(CallsContext);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("spark-theme", theme);
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "light" ? "#f4f6fb" : "#0a0a0f");
  }, [theme]);

  useEffect(() => {
    const sync = () => setUser(auth.getCurrentUser());

    window.addEventListener(AUTH_EVENT, sync);
    window.addEventListener("storage", sync);

    return () => {
      window.removeEventListener(AUTH_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link to={user ? "/chats" : "/"} className="brand">
          <span className="brand__mark">
            <SparkLogo size={26} color="#fff" />
          </span>
          <span className="brand__text">Spark</span>
        </Link>

        <nav className="site-header__nav" aria-label="Основная навигация">
          {user ? (
            <>
              <NavLink to="/chats" className={navCls}>Чаты</NavLink>
              <NavLink to="/profile" className={navCls}>Профиль</NavLink>
            </>
          ) : (
            <>
              <NavLink to="/features" className={navCls}>Возможности</NavLink>
              <NavLink to="/download" className={navCls}>Скачать</NavLink>
              <NavLink to="/faq" className={navCls}>FAQ</NavLink>
            </>
          )}
        </nav>

        <div className="site-header__actions">
          <button
            type="button"
            className="theme-toggle"
            aria-label={theme === "light" ? "Включить тёмную тему" : "Включить светлую тему"}
            title={theme === "light" ? "Тёмная тема" : "Светлая тема"}
            onClick={() => setTheme((current) => current === "light" ? "dark" : "light")}
          >
            {theme === "light" ? (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M20.2 15.3A8.4 8.4 0 0 1 8.7 3.8 8.5 8.5 0 1 0 20.2 15.3Z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" />
              </svg>
            )}
          </button>
          {user ? (
            <>
              {calls?.available && <button type="button" className="nav-link header-calls" aria-label="Звонки"
                title="Звонки" onClick={calls.openStandalone}>
                <span className="header-calls__icon" aria-hidden="true">☎</span>
                <span className="header-calls__label">Звонки</span>
              </button>}
              <NavLink to="/profile" className="header-user" title="Открыть профиль">
                @{user.username}
              </NavLink>
              <NavLink to="/settings" className="header-settings" aria-label="Настройки" title="Настройки">
                Настройки
              </NavLink>
            </>
          ) : (
            <>
              <NavLink to="/login" className={navCls}>Войти</NavLink>
              <Link to="/register" className="register-btn">Начать бесплатно</Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
