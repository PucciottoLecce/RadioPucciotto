// "Scatola nera": registro degli eventi della radio (gestionale e ascoltatore), per capire
// dal vero i blocchi che nelle prove simulate non si riproducono. NON cambia nessun
// comportamento: annota soltanto, nel browser di chi usa la pagina (localStorage), le
// ultime 1500 righe. Si legge aprendo /?log sullo stesso browser (vedi Registro.jsx).
const isGestionale = window.location.pathname.replace(/\/+$/, "") === "/gestionale";
export const REGISTRO_KEYS = { radio: "rp_log_radio", gestionale: "rp_log_gestionale" };
const KEY = isGestionale ? REGISTRO_KEYS.gestionale : REGISTRO_KEYS.radio;
const MAX = 1500;

let righe = [];
try { righe = JSON.parse(localStorage.getItem(KEY) || "[]"); if (!Array.isArray(righe)) righe = []; } catch (_) { righe = []; }

export function rlog(...parti) {
  try {
    const d = new Date();
    const ora = d.toLocaleDateString("it-IT") + " " + d.toLocaleTimeString("it-IT") + "." + String(d.getMilliseconds()).padStart(3, "0");
    const bg = document.visibilityState === "visible" ? "" : " [scheda nascosta]";
    righe.push(ora + bg + " | " + parti.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join(" "));
    if (righe.length > MAX) righe = righe.slice(-MAX);
    localStorage.setItem(KEY, JSON.stringify(righe));
  } catch (_) { /* il registro non deve mai disturbare la radio */ }
}
