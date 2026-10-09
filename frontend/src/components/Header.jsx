import { Link, NavLink, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import SparkLogo from "./SparkLogo";
import { auth } from "../api";

const navCls = ({ isActive }) =>
  isActive ? "nav-link nav-link--active" : "nav-link";

export default function Header() {
  const navigate = useNavigate();
  const [user, setUser] = useState(auth.getCurrentUser());

  useEffect(() => {
    const handler = () => setUser(auth.getCurrentUser());
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  const handleLogout = () => {
    auth.logoutUser();
    setUser(null);
    navigate("/login");
  };

  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link to={user ? "/chats" : "/"} className="brand">
          <span className="brand__mark">
            <SparkLogo size={26} color="#fff" />
          </span>
          <span className="brand__text">Spark</span>
        </Link>

        <nav className="site-header__nav">
          {user ? (
            <>
              <NavLink to="/chats" className={navCls}>
                Чаты
              </NavLink>
              <NavLink to="/profile" className={navCls}>
                Профиль
              </NavLink>
            </>
          ) : (
            <>
              <NavLink to="/features" className={navCls}>
                Возможности
              </NavLink>
              <NavLink to="/download" className={navCls}>
                Скачать
              </NavLink>
              <NavLink to="/faq" className={navCls}>
                FAQ
              </NavLink>
            </>
          )}
        </nav>

        <div className="site-header__actions">
          {user ? (
            <>
              <span className="header-user">@{user.username}</span>
              <button
                type="button"
                className="register-btn"
                onClick={handleLogout}
              >
                Выйти
              </button>
            </>
          ) : (
            <>
              <NavLink to="/login" className={navCls}>
                Войти
              </NavLink>
              <Link to="/register" className="register-btn">
                Начать бесплатно
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
