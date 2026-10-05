import { Link, NavLink } from "react-router-dom";
import SparkLogo from "./SparkLogo";

export default function Header() {
  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link to="/" className="brand">
          <span className="brand__mark">
            <SparkLogo size={26} />
          </span>
          <span className="brand__text">Spark</span>
        </Link>

        <nav className="site-header__nav">
          <NavLink
            to="/features"
            className={({ isActive }) =>
              isActive ? "nav-link nav-link--active" : "nav-link"
            }
          >
            Возможности
          </NavLink>
          <NavLink
            to="/download"
            className={({ isActive }) =>
              isActive ? "nav-link nav-link--active" : "nav-link"
            }
          >
            Скачать
          </NavLink>
          <NavLink
            to="/faq"
            className={({ isActive }) =>
              isActive ? "nav-link nav-link--active" : "nav-link"
            }
          >
            FAQ
          </NavLink>
        </nav>

        <div className="site-header__actions">
          <NavLink
            to="/login"
            className={({ isActive }) =>
              isActive ? "login-link login-link--active" : "login-link"
            }
          >
            Войти
          </NavLink>
          <Link to="/register" className="register-btn">
            Начать бесплатно
          </Link>
        </div>
      </div>
    </header>
  );
}
