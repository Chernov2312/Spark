import { Link } from "react-router-dom";
import SparkLogo from "../components/SparkLogo";

export default function LoginPage() {
  return (
    <main className="page-simple">
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 72,
          height: 72,
          background: "linear-gradient(135deg, #7c6cff 0%, #4a3df0 100%)",
          borderRadius: 20,
          color: "#fff",
          marginBottom: 24,
          boxShadow: "0 16px 40px rgba(124, 108, 255, 0.35)",
        }}
      >
        <SparkLogo size={36} />
      </div>
      <h1>Вход в Spark</h1>
      <p>Форма входа появится здесь позже.</p>
      <p>
        Нет аккаунта? <Link to="/register">Создать</Link>
      </p>
    </main>
  );
}
