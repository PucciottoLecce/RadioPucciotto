import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

// Configurazione Firebase (Console Firebase → Impostazioni progetto → Le tue app →
// "Radio Pucciotto"). Questi valori NON sono segreti: identificano il progetto e finiscono
// comunque nel codice pubblico del sito. La protezione vera sta nelle regole del Realtime
// Database (scrittura solo per l'account del proprietario) e nel login del gestionale.
const firebaseConfig = {
  apiKey: "AIzaSyBrrHdBluFZ4LN7yz3ovfD_sJ7GdHD4GYk",
  authDomain: "radiopucciotto-802bc.firebaseapp.com",
  databaseURL: "https://radiopucciotto-802bc-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "radiopucciotto-802bc",
  storageBucket: "radiopucciotto-802bc.firebasestorage.app",
  messagingSenderId: "18627688266",
  appId: "1:18627688266:web:052311272ac7aff58fb3b3",
};

export const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);

// UID dell'unico account che può trasmettere (Firebase → Authentication → Users).
// Deve coincidere con quello scritto nelle regole del database.
export const OWNER_UID = "rQuRDBStbaMqbtUyLmP9634VSZT2";
