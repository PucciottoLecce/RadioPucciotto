import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

// Configurazione Firebase — databaseURL già impostato.
// Se hai bisogno di aggiungere autenticazione in futuro, recupera
// apiKey, authDomain, projectId ecc. da:
//   Console Firebase → Impostazioni progetto (⚙) → Le tue app → SDK setup & configuration
const firebaseConfig = {
  databaseURL: "https://radiopucciotto-802bc-default-rtdb.europe-west1.firebasedatabase.app/",
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
