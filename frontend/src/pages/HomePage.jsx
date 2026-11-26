import { Link } from "react-router-dom";
import SparkLogo from "../components/SparkLogo";

export default function HomePage() {
  return (
    <main className="home">
      <div className="home__hero">
        <section className="home__intro" aria-labelledby="home-title">
          <div className="home__eyebrow">
            <span className="home__status-dot" aria-hidden="true" />
            Мессенджер для важных разговоров
          </div>
          <h1 id="home-title" className="home__title">
            Будь на связи <span className="home__title-accent">своим кругом</span>
          </h1>
          <p className="home__subtitle">
            Личные и групповые чаты, обмен файлами и история сообщений — в одном
            простом и быстром приложении.
          </p>

          <div className="home__actions">
            <Link to="/register" className="home__btn home__btn--primary">
              Создать аккаунт <span aria-hidden="true">→</span>
            </Link>
            <Link to="/features" className="home__btn">
              Узнать больше
            </Link>
          </div>
          <p className="home__note">Бесплатно начать · Регистрация за минуту</p>
        </section>

        <section className="home__preview" aria-label="Возможности Spark">
          <div className="home__preview-top">
            <div className="home__logo">
              <SparkLogo size={30} />
            </div>
            <div>
              <p className="home__preview-label">Ваше пространство</p>
              <p className="home__preview-title">Разговоры без шума</p>
            </div>
            <span className="home__online" aria-label="На связи" />
          </div>
          <div className="home__preview-message home__preview-message--incoming">
            <span className="home__avatar" aria-hidden="true">А</span>
            <div>
              <span className="home__message-name">Аня</span>
              <p>Увидимся сегодня? ✨</p>
            </div>
            <time>12:41</time>
          </div>
          <div className="home__preview-message home__preview-message--outgoing">
            <div>
              <span className="home__message-name">Вы</span>
              <p>Конечно! Уже выхожу</p>
            </div>
            <time>12:42</time>
          </div>
          <div className="home__preview-footer">
            <span>Сообщение...</span>
            <span className="home__send" aria-hidden="true">↑</span>
          </div>
        </section>
      </div>

      <section className="home__benefits" aria-label="Преимущества">
        <article className="feature">
          <div className="feature__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none"><path d="M13.2 2.8 5.8 13h5l-.2 8.2L18.2 11h-5.1l.1-8.2Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg>
          </div>
          <div>
            <h2 className="feature__title">Быстро и просто</h2>
            <p className="feature__text">Откройте чат и сразу переходите к разговору.</p>
          </div>
        </article>
        <article className="feature">
          <div className="feature__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none"><path d="M4 7.5h6l2 2H20v8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5v-10Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /><path d="M4.5 7.5V6A1.5 1.5 0 0 1 6 4.5h4l2 2H18" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg>
          </div>
          <div>
            <h2 className="feature__title">Всё на месте</h2>
            <p className="feature__text">Сообщения и файлы собраны в одном пространстве.</p>
          </div>
        </article>
        <article className="feature">
          <div className="feature__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none"><rect x="6.5" y="3.5" width="11" height="17" rx="2" stroke="currentColor" strokeWidth="1.7" /><path d="M10 17.5h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
          </div>
          <div>
            <h2 className="feature__title">Всегда под рукой</h2>
            <p className="feature__text">Продолжайте переписку с любого устройства.</p>
          </div>
        </article>
      </section>
    </main>
  );
}
