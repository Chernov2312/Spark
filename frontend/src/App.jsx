import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import Header from "./components/Header";
import Footer from "./components/Footer";
import HomePage from "./pages/HomePage";
import RegisterPage from "./pages/RegisterPage";
import LoginPage from "./pages/LoginPage";
import ProfilePage from "./pages/ProfilePage";
import FaqPage from "./pages/FaqPage";
import ChatsPage from "./pages/ChatsPage";
import GuestCallPage from "./pages/GuestCallPage";
import EmailVerificationPage from "./pages/EmailVerificationPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
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
  const { pathname } = useLocation();
  const isVerificationPage = pathname.startsWith("/verify-email/");
  const isChatsPage = pathname === "/chats" || pathname.startsWith("/chats/");

  return (
    <>
      {!isVerificationPage && <Header />}
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/verify-email/:token" element={<EmailVerificationPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password/:token" element={<ResetPasswordPage />} />
        <Route path="/faq" element={<FaqPage />} />
        <Route path="/call/join" element={<GuestCallPage />} />
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
        <Route
          path="/profile"
          element={
            <PrivateRoute>
              <ProfilePage />
            </PrivateRoute>
          }
        />
        <Route path="/profile-preview" element={<ProfilePage demo />} />
        <Route
          path="/features"
          element={
            <SimplePage
              title="Возможности Spark"
              text="Личные и групповые чаты, обмен файлами и удобный поиск по переписке."
            />
          }
        />
        <Route
          path="/download"
          element={
            <SimplePage
              title="Скачать Spark"
              text="Мобильные и настольные приложения появятся здесь. Пока Spark доступен в браузере."
            />
          }
        />
        <Route path="*" element={<NotFound />} />
      </Routes>
      {!isVerificationPage && !isChatsPage && <Footer />}
    </>
  );
}
