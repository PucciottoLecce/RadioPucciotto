import React, { useState } from "react";
import { REGISTRO_KEYS } from "./registro.js";

// Pagina /?log: mostra la "scatola nera" di QUESTO browser (radio + gestionale) con un
// pulsante per copiarla. Legge soltanto: non tocca la radio né il database.
const leggi = (k) => { try { return JSON.parse(localStorage.getItem(k) || "[]"); } catch (_) { return []; } };

export default function Registro() {
  const [copiato, setCopiato] = useState("");
  const radio = leggi(REGISTRO_KEYS.radio);
  const gest = leggi(REGISTRO_KEYS.gestionale);
  const testo = "=== RADIO (ascoltatore) — ultime " + Math.min(radio.length, 400) + " righe ===\n" + radio.slice(-400).join("\n")
    + "\n\n=== GESTIONALE — ultime " + Math.min(gest.length, 400) + " righe ===\n" + gest.slice(-400).join("\n");
  const copia = () => {
    const ok = () => setCopiato("Copiato! Incollalo nella chat.");
    if (navigator.clipboard) navigator.clipboard.writeText(testo).then(ok, () => setCopiato("Copia non riuscita: seleziona il testo e copialo a mano."));
    else setCopiato("Seleziona il testo e copialo a mano.");
  };
  const svuota = () => { try { localStorage.removeItem(REGISTRO_KEYS.radio); localStorage.removeItem(REGISTRO_KEYS.gestionale); } catch (_) {} window.location.reload(); };
  return (
    <div style={{ padding: 16, fontFamily: "system-ui, sans-serif", maxWidth: 1000, margin: "0 auto" }}>
      <h2 style={{ margin: "0 0 8px" }}>Registro Radio Pucciotto</h2>
      <p style={{ margin: "0 0 12px", color: "#555" }}>Premi <b>Copia</b> e incolla il testo nella chat. Il registro resta solo in questo browser.</p>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <button onClick={copia} style={{ padding: "10px 18px", fontSize: 15, fontWeight: 700, background: "#c0392b", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}>Copia</button>
        <button onClick={svuota} style={{ padding: "10px 18px", fontSize: 15, background: "#fff", border: "1px solid #ccc", borderRadius: 8, cursor: "pointer" }}>Svuota registro</button>
        <span style={{ alignSelf: "center", color: "#27ae60" }}>{copiato}</span>
      </div>
      <textarea readOnly value={testo} style={{ width: "100%", height: "70vh", fontFamily: "monospace", fontSize: 12 }} />
    </div>
  );
}
