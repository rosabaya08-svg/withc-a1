import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getDatabase } from "firebase/database";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const fallbackFirebaseConfig = {
  apiKey: "AIzaSyC_atjLpnjU6sDMczNe48hKm6md_9by4nk",
  authDomain: "signage-partner.firebaseapp.com",
  projectId: "signage-partner",
  storageBucket: "signage-partner.firebasestorage.app",
  messagingSenderId: "110988650080",
  appId: "1:110988650080:web:63882e54cf1ca98ec6c505",
  databaseURL: "https://signage-partner-default-rtdb.firebaseio.com"
};

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || fallbackFirebaseConfig.apiKey,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || fallbackFirebaseConfig.authDomain,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || fallbackFirebaseConfig.projectId,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || fallbackFirebaseConfig.storageBucket,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || fallbackFirebaseConfig.messagingSenderId,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || fallbackFirebaseConfig.appId,
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL || fallbackFirebaseConfig.databaseURL
};

export function hasFirebaseConfig() {
  return Boolean(
    firebaseConfig.apiKey &&
      firebaseConfig.authDomain &&
      firebaseConfig.projectId &&
      firebaseConfig.storageBucket &&
      firebaseConfig.messagingSenderId &&
      firebaseConfig.appId
  );
}

export function getFirebaseServices() {
  if (!hasFirebaseConfig()) {
    throw new Error("Firebase environment variables are missing.");
  }

  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

  return {
    app,
    auth: getAuth(app),
    db: getFirestore(app),
    rtdb: getDatabase(app),
    storage: getStorage(app),
    googleProvider: new GoogleAuthProvider()
  };
}
