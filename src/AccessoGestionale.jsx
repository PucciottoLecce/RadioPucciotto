import React, { useEffect, useState } from "react";
import { app, OWNER_UID } from "./firebase.js";

// Schermata di accesso del gestionale (email + password dell'account Firebase del
// proprietario). Il gestionale vero (children) viene montato SOLO dopo l'accesso, così
// parte esattamente come prima. Il codice del login viene scaricato solo qui: la radio
// degli ascoltatori non lo carica nemmeno. Si resta collegati anche chiudendo il browser.
const RED = "#c0392b";

export default function AccessoGestionale({ children }) {
  const [auth, setAuth] = useState(null);       // modulo firebase/auth + istanza
  const [user, setUser] = useState(undefined);  // undefined = sto controllando
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errore, setErrore] = useState("");
  const [attendi, setAttendi] = useState(false);

  useEffect(() => {
    let stop = () => {};
    import("firebase/auth")
      .then((m) => {
        const inst = m.getAuth(app);
        setAuth({ m, inst });
        stop = m.onAuthStateChanged(inst, (u) => setUser(u || null));
      })
      .catch(() => { setErrore("Impossibile caricare l'accesso. Controlla la connessione e ricarica la pagina."); setUser(null); });
    return () => stop();
  }, []);

  const accedi = (e) => {
    e.preventDefault();
    if (!auth) return;
    setErrore(""); setAttendi(true);
    auth.m.signInWithEmailAndPassword(auth.inst, email.trim(), password)
      .catch((err) => {
        const c = err && err.code;
        setErrore(
          c === "auth/too-many-requests" ? "Troppi tentativi: riprova tra qualche minuto."
          : c === "auth/network-request-failed" ? "Connessione assente: riprova."
          : "Email o password non corrette."
        );
      })
      .finally(() => { setAttendi(false); setPassword(""); });
  };
  const esci = () => { if (auth) auth.m.signOut(auth.inst); };

  if (user === undefined) {
    return <Pagina><div style={{ color: "#888" }}>Controllo l'accesso…</div></Pagina>;
  }
  if (user && user.uid === OWNER_UID) {
    return (
      <>
        {children}
        <button onClick={esci} title={"Collegato come " + (user.email || "")}
          style={{ position: "fixed", right: 10, bottom: 10, zIndex: 50, background: "#fff", color: "#888", border: "1px solid rgba(0,0,0,0.12)", borderRadius: 8, padding: "4px 10px", fontSize: 11, cursor: "pointer" }}>
          Esci
        </button>
      </>
    );
  }
  if (user) {
    return (
      <Pagina>
        <div style={{ marginBottom: 14 }}>L'account <b>{user.email}</b> non è abilitato a trasmettere.</div>
        <button onClick={esci} style={bottone}>Esci e accedi con un altro account</button>
      </Pagina>
    );
  }
  return (
    <Pagina>
      <form onSubmit={accedi} style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%" }}>
        <input type="email" autoComplete="username" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required style={campo} />
        <input type="password" autoComplete="current-password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required style={campo} />
        {errore && <div style={{ color: RED, fontSize: 13 }}>{errore}</div>}
        <button type="submit" disabled={attendi || !auth} style={bottone}>{attendi ? "Accesso…" : "Accedi"}</button>
      </form>
    </Pagina>
  );
}

const campo = { padding: "12px 14px", borderRadius: 10, border: "1px solid rgba(0,0,0,0.15)", fontSize: 15 };
const bottone = { padding: "12px 14px", borderRadius: 10, border: "none", background: RED, color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer" };

function Pagina({ children }) {
  return (
    <div style={{ minHeight: "100vh", background: "#faf7f4", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, fontFamily: "'DM Sans', system-ui, sans-serif" }}>
      <div style={{ width: "100%", maxWidth: 360, background: "#fff", borderRadius: 18, padding: 28, boxShadow: "0 4px 20px rgba(0,0,0,.06)", textAlign: "center" }}>
        <img src="/logo.png" alt="Pucciotto" style={{ width: 64, height: 64, objectFit: "contain", marginBottom: 8 }} />
        <div style={{ fontWeight: 700, fontSize: 20, marginBottom: 4 }}>Gestionale Radio Pucciotto</div>
        <div style={{ fontSize: 12, color: "#888", marginBottom: 20 }}>Accesso riservato</div>
        {children}
      </div>
    </div>
  );
}
