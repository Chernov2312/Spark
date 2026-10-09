/* ============================================================
   src/api/index.js
   Единая точка входа в слой работы с API.

   Использование в компонентах:
     import { auth, users } from '../api';

     await auth.loginUser({ email, password });
     await users.getMe();
   ============================================================ */

// --- Низкоуровневый клиент ---
export { api, API_BASE, setToken, getToken, clearToken } from "./client";

// --- Модули по доменам ---
export * as auth from "./auth";
export * as users from "./users";
