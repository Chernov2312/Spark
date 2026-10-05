import { useNavigate } from "react-router-dom";
import RegisterForm from "../components/RegisterForm";

export default function RegisterPage() {
  const navigate = useNavigate();

  return (
    <RegisterForm
      onSuccess={(data) => {
        alert(`Добро пожаловать в Spark, ${data.user.name}!`);
        navigate("/");
      }}
    />
  );
}
