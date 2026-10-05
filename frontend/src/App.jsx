import { Routes, Route } from "react-router-dom";
import Header from "./components/Header";
import HomePage from "./pages/HomePage";
import RegisterPage from "./pages/RegisterPage";
import LoginPage from "./pages/LoginPage";
import NotFound from "./components/NotFound";

function SimplePage({ title, text }) {
  return (
    <main className="page-simple">
      <h1>{title}</h1>
      <p>{text}</p>
    </main>
  );
}

export default function App() {
  return (
    <>
      <Header />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/features"
          element={
            <SimplePage
              title="Возможности Spark"
              text="Раздел в разработке. Скоро здесь будет подробный список."
            />
          }
        />
        <Route
          path="/download"
          element={
            <SimplePage
              title="Скачать Spark"
              text="Ссылки на iOS, Android, Windows и macOS появятся позже."
            />
          }
        />
        <Route
          path="/faq"
          element={
            <SimplePage
              title="FAQ"
              text="Частые вопросы и ответы скоро будут здесь."
            />
          }
        />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  );
}
