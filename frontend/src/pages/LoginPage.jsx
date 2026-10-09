import { Link, useNavigate } from "react-router-dom";
import LoginForm from "../components/LoginForm";

export default function LoginPage() {
  const navigate = useNavigate();

  return (
    <>
      <LoginForm onSuccess={() => navigate("/chats")} />
      <p
        style={{
          textAlign: "center",
          marginTop: 16,
          color: "var(--text-muted)",
        }}
      >
        Нет аккаунта? <Link to="/register">Создать</Link>
      </p>
    </>
  );
}
