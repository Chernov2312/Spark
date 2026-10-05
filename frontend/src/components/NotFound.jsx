import { Link, useLocation } from "react-router-dom";

export default function NotFound() {
  const { pathname } = useLocation();

  return (
    <main className="not-found">
      <div className="not-found__code">404</div>
      <h1 className="not-found__title">Такой страницы в Spark нет</h1>
      <p className="not-found__text">
        Мы не нашли страницу по адресу{" "}
        <code className="not-found__path">{pathname}</code>. Возможно, она была
        удалена или вы ошиблись в ссылке.
      </p>
      <div className="not-found__actions">
        <Link to="/" className="not-found__btn not-found__btn--primary">
          На главную
        </Link>
        <Link to="/register" className="not-found__btn">
          Создать аккаунт
        </Link>
      </div>
    </main>
  );
}
