// إعدادات Firebase الخاصة بمشروع EBM Production System
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyARcxaAgJI5AxZuvrR8OxcBn4l0J5fxCIs",
  authDomain: "tyyt-b1d84.firebaseapp.com",
  databaseURL: "https://tyyt-b1d84-default-rtdb.firebaseio.com",
  projectId: "tyyt-b1d84",
  storageBucket: "tyyt-b1d84.firebasestorage.app",
  messagingSenderId: "335241087888",
  appId: "1:335241087888:web:19d58929234f0c706e8115",
  measurementId: "G-PFBDLBCM29"
};

export const firebaseConfigured = true;
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);
