// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBBkt2QWCFmOZqZxeHhZiMKVyLhxOm69gE",
  authDomain: "pdmuappweb.firebaseapp.com",
  projectId: "pdmuappweb",
  storageBucket: "pdmuappweb.firebasestorage.app",
  messagingSenderId: "867236556092",
  appId: "1:867236556092:web:0795bdc3651d71a108c239"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export default app;