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
            Быстрый и безопасный мессенджер. Общайтесь с кем угодно, где угодно.
          </p>
          <div className="site-footer__socials">
            <a href="#" aria-label="Telegram" className="site-footer__social">
              ✈
            </a>
            <a href="#" aria-label="VK" className="site-footer__social">
              VK
            </a>
            <a href="#" aria-label="GitHub" className="site-footer__social">
              GH
            </a>
          </div>
        </div>

        <div className="site-footer__col">
          <h4 className="site-footer__title">Продукт</h4>
          <ul className="site-footer__list">
            <li>
              <Link to="/features">Возможности</Link>
            </li>
            <li>
              <Link to="/download">Скачать</Link>
            </li>
            <li>
              <Link to="/chats">Чаты</Link>
            </li>
            <li>
              <Link to="/faq">FAQ</Link>
            </li>
          </ul>
        </div>

        <div className="site-footer__col">
          <h4 className="site-footer__title">Компания</h4>
          <ul className="site-footer__list">
            <li>
              <a href="#">О нас</a>
            </li>
            <li>
              <a href="#">Блог</a>
            </li>
            <li>
              <a href="#">Вакансии</a>
            </li>
            <li>
              <a href="#">Контакты</a>
            </li>
          </ul>
        </div>

        <div className="site-footer__col">
          <h4 className="site-footer__title">Правовое</h4>
          <ul className="site-footer__list">
            <li>
              <a href="#">Политика конфиденциальности</a>
            </li>
            <li>
              <a href="#">Пользовательское соглашение</a>
            </li>
            <li>
              <a href="#">Обработка cookie</a>
            </li>
            <li>
              <a href="#">Помощь</a>
            </li>
          </ul>
        </div>
      </div>

      <div className="site-footer__bottom">
        <div className="site-footer__inner site-footer__inner--bottom">
          <span>© {year} Spark. Все права защищены.</span>
          <span className="site-footer__made">Сделано с ♥ командой Spark</span>
        </div>
      </div>
    </footer>
  );
}
