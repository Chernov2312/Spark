import { Link } from "react-router-dom";
import SparkLogo from "./SparkLogo";

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <div className="site-footer__brand">
          <Link to="/" className="site-footer__logo">
            <span className="site-footer__mark">
              <SparkLogo size={24} color="#fff" />
            </span>
            <span className="site-footer__name">Spark</span>
          </Link>
          <p className="site-footer__tagline">
            Быстрый и удобный мессенджер для ваших разговоров.
          </p>
        </div>

        <nav className="site-footer__col" aria-label="Разделы сайта">
          <h2 className="site-footer__title">Разделы</h2>
          <ul className="site-footer__list">
            <li><Link to="/features">Возможности</Link></li>
            <li><Link to="/download">Скачать</Link></li>
            <li><Link to="/faq">Частые вопросы</Link></li>
          </ul>
        </nav>

        <nav className="site-footer__col" aria-label="Аккаунт">
          <h2 className="site-footer__title">Аккаунт</h2>
          <ul className="site-footer__list">
            <li><Link to="/login">Войти</Link></li>
            <li><Link to="/register">Создать аккаунт</Link></li>
          </ul>
        </nav>
      </div>

      <div className="site-footer__bottom">
        <div className="site-footer__inner site-footer__inner--bottom">
          <span>© {year} Spark</span>
          <span className="site-footer__made">Оставайтесь на связи</span>
        </div>
      </div>
    </footer>
  );
}
