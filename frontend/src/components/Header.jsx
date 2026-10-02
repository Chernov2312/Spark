export default function Header() {
  return (
    <header className="site-header">
      <div className="site-header__inner">
        <div className="site-header__logo">
          <span className="logo-mark">ITMO</span>
        </div>

        <nav className="site-header__nav">
          <a href="#">Олимпиады</a>
          <a href="#">Часто задаваемые вопросы</a>
        </nav>

        <div className="site-header__actions">
          <a href="#" className="login-link">
            <span className="login-icon">↪</span> Вход
          </a>
          <a href="#" className="register-btn">
            Регистрация
          </a>
        </div>
      </div>
    </header>
  );
}
