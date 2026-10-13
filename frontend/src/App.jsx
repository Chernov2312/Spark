import { Routes, Route, Navigate } from "react-router-dom";
import Header from "./components/Header";
import Footer from "./components/Footer";
import HomePage from "./pages/HomePage";
import RegisterPage from "./pages/RegisterPage";
import LoginPage from "./pages/LoginPage";
import ProfilePage from "./pages/ProfilePage";
import FaqPage from "./pages/FaqPage";
import ChatsPage from "./pages/ChatsPage";
import NotFound from "./components/NotFound";
import { auth } from "./api";

function PrivateRoute({ children }) {
  return auth.isAuthenticated() ? children : <Navigate to="/login" replace />;
}

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
        <Route path="/faq" element={<FaqPage />} />
        <Route
          path="/chats"
          element={
            <PrivateRoute>
              <ChatsPage />
            </PrivateRoute>
          }
        />
        <Route
          path="/chats/:chatId"
          element={
            <PrivateRoute>
              <ChatsPage />
            </PrivateRoute>
          }
        />

        {/* Реальный профиль — только для авторизованных, работает через API */}
        <Route
          path="/profile"
          element={
            <PrivateRoute>
              <ProfilePage />
            </PrivateRoute>
          }
        />

        {/* Демо-профиль — публичный, без API */}
        <Route path="/profile-preview" element={<ProfilePage demo />} />

        <Route
          path="/features"
          element={
            <SimplePage
              title="Возможности Spark"
              text="Скоро здесь появится подробный список."
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
            <SimplePage title="FAQ" text="Отвечаем на частые вопросы." />
          }
        />

        <Route path="*" element={<NotFound />} />
      </Routes>
      <Footer />
    </>
  );
}
