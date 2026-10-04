import { Link } from "react-router-dom";
import SparkLogo from "../components/SparkLogo";

export default function HomePage() {
  return (
    <main className="home">
      <div className="home__hero">
        <div className="home__logo">
          <SparkLogo size={72} />
        </div>

        <h1 className="home__title">
          Общайся <span className="home__title-accent">мгновенно</span>
          <br />с кем угодно, где угодно
        </h1>

        <p className="home__subtitle">
          Spark — быстрый и безопасный мессенджер. Личные чаты, группы, каналы,
          звонки и обмен файлами. Работает на всех устройствах.
        </p>

        <div className="home__actions">
          <Link to="/register" className="home__btn home__btn--primary">
            Создать аккаунт
          </Link>
          <Link to="/download" className="home__btn">
            Скачать приложение
          </Link>
        </div>

        <div className="home__features">
          <div className="feature">
            <div className="feature__icon">⚡</div>
            <h3 className="feature__title">Мгновенно</h3>
            <p className="feature__text">
              Сообщения доходят за миллисекунды. Никаких задержек и лагов.
            </p>
          </div>
          <div className="feature">
            <div className="feature__icon">🔒</div>
            <h3 className="feature__title">Приватно</h3>
            <p className="feature__text">
              End-to-end шифрование в секретных чатах. Ваши данные — только
              ваши.
            </p>
          </div>
          <div className="feature">
            <div className="feature__icon">☁</div>
            <h3 className="feature__title">Синхронно</h3>
            <p className="feature__text">
              История хранится в облаке и доступна с любого устройства.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
