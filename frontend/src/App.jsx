import Header from "./components/Header";
import RegisterForm from "./components/RegisterForm";

export default function App() {
  return (
    <>
      <Header />
      <RegisterForm
        onSuccess={(data) => {
          alert(`Добро пожаловать, ${data.user.name}!`);
        }}
      />
    </>
  );
}
