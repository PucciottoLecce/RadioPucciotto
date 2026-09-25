import React, { useState, useRef, useEffect, useMemo } from "react";
import { Play, Pause, SkipForward, SkipBack, Volume2, VolumeX, Trash2, Shuffle, Music, Check } from "lucide-react";
import { db } from "./firebase.js";
import { ref, set, get, onValue, onDisconnect } from "firebase/database";

const RED   = "#c0392b";
const WHITE = "#ffffff";
const BLACK = "#1a1a1a";
const CREAM = "#faf7f4";
const COLOR_PALETTE = [RED, "#e67e22", "#2c3e50", "#27ae60", "#8e44ad", "#d35400"];
const MY_SONGS_COLOR = "#c0392b";

const FALLBACK_TRACKS = [
  { id: 1, title: "Notte Elettrica", artist: "SoundHelix", category: "Elettronica", url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3", color: "#FF6B4A", isCustom: false },
  { id: 2, title: "Strada di Casa", artist: "SoundHelix", category: "Acustico", url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3", color: "#4ADE80", isCustom: false },
  { id: 3, title: "Onde Lunghe", artist: "SoundHelix", category: "Chill", url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3", color: "#60A5FA", isCustom: false },
  { id: 4, title: "Vento del Sud", artist: "SoundHelix", category: "Acustico", url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3", color: "#4ADE80", isCustom: false },
];

// Chiave API YouTube Data v3 — creala gratis su https://console.cloud.google.com/
// (abilita "YouTube Data API v3" e genera una API key, poi incollala qui sotto)
const YOUTUBE_API_KEY = import.meta.env.VITE_YOUTUBE_API_KEY || "";

// Playlist di riserva usata mentre la ricerca automatica è in corso, o se fallisce
const YOUTUBE_FALLBACK_TRACKS = [
  { id: "yt1", videoId: "dQw4w9WgXcQ", title: "Never Gonna Give You Up", artist: "Rick Astley",  category: "Pop",         color: "#c0392b" },
  { id: "yt2", videoId: "fJ9rUzIMcZQ", title: "Bohemian Rhapsody",        artist: "Queen",         category: "Rock",        color: "#e67e22" },
  { id: "yt3", videoId: "JGwWNGJdvx8", title: "Shape of You",             artist: "Ed Sheeran",    category: "Pop",         color: "#c0392b" },
  { id: "yt4", videoId: "kJQP7kiw5Fk", title: "Despacito",                artist: "Luis Fonsi",    category: "Latino",      color: "#27ae60" },
  { id: "yt5", videoId: "hTWKbfoikeg", title: "Smells Like Teen Spirit",  artist: "Nirvana",       category: "Rock",        color: "#e67e22" },
  { id: "yt6", videoId: "rYEDA3JcQqw", title: "Rolling in the Deep",      artist: "Adele",         category: "Soul",        color: "#8e44ad" },
  { id: "yt7", videoId: "4NRXx6U8ABQ", title: "Blinding Lights",         artist: "The Weeknd",    category: "Elettronica", color: "#2c3e50" },
  { id: "yt8", videoId: "OPf0YbXqDm0", title: "Uptown Funk",              artist: "Bruno Mars",    category: "Funk",        color: "#d35400" },
].map((t) => ({ ...t, url: null, isCustom: false }));

// Gli spot vanno in onda A ROTAZIONE, in quest'ordine: 1 → 2 → 3 → 1 … Per aggiungere
// uno spot basta mettere il file in public/ads/ e aggiungerlo in fondo a questa lista.
const AD_SPOTS = [
  "/ads/spot-piucciotto.mp3",
  "/ads/spot-piucciotto-2.mp3",
  "/ads/spot-piucciotto-3.mp3",
];

const AD_LINES = [
  "Pucciotto — il sapore di casa, ogni giorno.",
  "Solo da Pucciotto: qualità che si sente.",
  "Pucciotto ti aspetta, vieni a scoprirlo.",
  "Il segreto di un buon momento? Pucciotto.",
];

// Timer "che non si addormenta": chiama fn ogni `ms` millisecondi usando un piccolo Web
// Worker invece di un setInterval della pagina. Chrome, dopo qualche minuto di scheda
// nascosta e SILENZIOSA (gestionale col "Muto generale" o volume a zero, oppure player
// fermo), rallenta i timer della pagina fino a una volta al minuto; quelli dei worker no.
// Se il worker non si può creare si ripiega sul normale setInterval. Ritorna la funzione
// per fermarlo.
function startTicker(fn, ms) {
  try {
    const url = URL.createObjectURL(new Blob([`setInterval(() => postMessage(0), ${ms});`], { type: "text/javascript" }));
    const worker = new Worker(url);
    worker.onmessage = () => fn();
    return () => { worker.terminate(); URL.revokeObjectURL(url); };
  } catch (_) {
    const id = setInterval(fn, ms);
    return () => clearInterval(id);
  }
}

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function RadioPucciotto() {
  // Determina modalità all'avvio: ?gestionale nell'URL = pannello admin.
  // DEVE stare qui, prima di ogni altra cosa: viene usata anche dentro le dependency
  // array di alcuni useEffect più sotto, e quelle vengono valutate SUBITO durante il
  // render (non in modo differito come il corpo degli effetti) — dichiararla più in
  // basso nel file causava un errore che bloccava il caricamento dell'intera pagina.
  const isGestionale = window.location.search.includes("gestionale");
  const [tracks, setTracks] = useState(YOUTUBE_FALLBACK_TRACKS);
  const [customTracks, setCustomTracks] = useState([]);

  const [loadingTracks, setLoadingTracks] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [category, setCategory] = useState("Tutti");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);
  // Mute generale: silenzia SOLO l'ascolto locale nel gestionale (audio.muted sul tag
  // <audio> e sul player YouTube, vedi effetto dedicato più sotto). NON deve impedire
  // l'avvio né la pubblicazione su Firebase degli spot (né quello ogni 2 minuti né
  // quello ogni 3 canzoni): la radio pubblica deve continuare a trasmetterli e a sentirli
  // normalmente anche se il gestore si è mutato in loco.
  const [isMuted, setIsMuted] = useState(false);
  // Volume dedicato degli spot pubblicitari, indipendente dal volume generale ma
  // scalato su di esso (vedi calcolo in playSpotInBackground/playSpotSolo/effetto
  // pubblico): a volume generale = 0 anche gli spot devono essere a 0, non più
  // udibili "comunque" come prima (c'era un pavimento fisso +0.2 che li rendeva
  // sempre percepibili anche a volume minimo).
  const [adVolume, setAdVolume] = useState(0.7);
  // Attiva/disattiva l'unico meccanismo di spot rimasto: quello periodico "ogni N minuti"
  // in sottofondo (sopra la musica). Lo spot legato al numero di canzoni è stato rimosso.
  // Questa impostazione e i minuti qui sotto vengono ricordati dal browser del gestionale
  // (localStorage): prima tornavano a "attivo, ogni 2 minuti" ad ogni ricaricamento.
  const [adEvery2MinEnabled, setAdEvery2MinEnabled] = useState(() => {
    try { const v = localStorage.getItem("rp_ad_enabled"); return v === null ? true : v === "1"; } catch (_) { return true; }
  });
  // Minuti configurabili tra uno spot "in sottofondo" e il successivo (prima era
  // fisso a 2 minuti, non modificabile dal gestionale).
  const [adIntervalMinutes, setAdIntervalMinutes] = useState(() => {
    try { const v = parseInt(localStorage.getItem("rp_ad_minutes"), 10); return v >= 1 ? v : 2; } catch (_) { return 2; }
  });
  useEffect(() => {
    if (!isGestionale) return;
    try {
      localStorage.setItem("rp_ad_enabled", adEvery2MinEnabled ? "1" : "0");
      localStorage.setItem("rp_ad_minutes", String(adIntervalMinutes));
    } catch (_) { /* memoria del browser non disponibile: pazienza, restano i valori in uso */ }
  }, [adEvery2MinEnabled, adIntervalMinutes, isGestionale]);
  const [adLine, setAdLine] = useState(0);
  const [status, setStatus] = useState("Pronto");
  const [shuffleMode, setShuffleMode] = useState(false);
  // La playlist shuffled è salvata in state, NON ricalcolata ad ogni render
  const [shuffledList, setShuffledList] = useState([]);

  // Ref sincronizzato col mute, usato dentro l'intervallo dei 2 minuti (che di proposito
  // NON dipende da isMuted, così come già non dipende da volume/adVolume, per non
  // resettare il countdown ogni volta che il gestore preme mute/smute).
  const isMutedRef = useRef(false);
  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);
  // Serve al timer degli spot "ogni N minuti": senza questo ref, l'intervallo doveva
  // avere isPlaying tra le dipendenze e veniva distrutto/ricreato (quindi il conteggio
  // dei minuti si azzerava) ad ogni singolo play/pausa o cambio canzone.
  const isPlayingRef = useRef(false);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  // Volume sempre aggiornato: i ripristini a fine spot devono tornare al volume ATTUALE,
  // non a quello "fotografato" quando lo spot è partito (che poteva essere cambiato nel
  // frattempo spostando lo slider). Prima restore() usava il valore congelato all'avvio.
  const volumeRef = useRef(volume);
  useEffect(() => { volumeRef.current = volume; }, [volume]);
  // true SOLO mentre uno spot sta abbassando la musica ("ducking"). Serve a far sì che,
  // se si sposta lo slider del volume MENTRE uno spot è in corso, la musica resti
  // abbassata invece di tornare improvvisamente a tutto volume (l'effetto sul volume,
  // più sotto, tiene conto di questo flag).
  const isDuckingRef = useRef(false);
  // Id del timeout di sicurezza dello spot in corso (vedi armSpotRestore).
  const spotSafetyTimerRef = useRef(null);
  // Posizione del PROSSIMO spot nella rotazione di AD_SPOTS. È ricordata dal browser del
  // gestionale, così dopo un ricaricamento la rotazione riprende da dove era rimasta
  // invece di ripartire sempre dal primo spot.
  const nextSpotIndexRef = useRef((() => {
    try { const v = parseInt(localStorage.getItem("rp_next_spot"), 10); return v >= 0 ? v : 0; } catch (_) { return 0; }
  })());
  // Contatore degli errori YouTube consecutivi (video non incorporabili/rimossi): serve a
  // frenare l'auto-skip, altrimenti una serie di video "morti" fa saltare tutta la
  // playlist a raffica senza mai suonare.
  const ytErrorCountRef = useRef(0);
  const ytLastErrorAtRef = useRef(0);
  // Condiviso tra i due meccanismi (ogni N minuti / ogni 3 canzoni): senza questo,
  // se scattavano vicini nel tempo gli spot partivano uno dietro l'altro senza pausa
  // ("all'impazzata"). Impedisce un nuovo spot per almeno MIN_GAP_BETWEEN_ADS_S
  // secondi dopo la fine dell'ultimo, qualunque sia il meccanismo che lo ha avviato.
  const lastAdEndedAtRef = useRef(0);
  // Distanza minima FISSA tra due spot, qualunque meccanismo li avvii: serve solo a
  // evitare che due spot partano letteralmente attaccati ("all'impazzata"), non a
  // dettare la cadenza. Prima era legata al campo "Spot ogni ___ min" (interval*60):
  // così lo spot "ogni 3 canzoni" veniva soppresso per MINUTI dal timer, sembrando
  // partire "come gli pare" e dando l'impressione che i due meccanismi fossero
  // accoppiati. Ora è un valore breve e costante, indipendente dall'intervallo dei
  // minuti: i due meccanismi (ogni N minuti / ogni 3 canzoni) restano indipendenti.
  const MIN_GAP_BETWEEN_ADS_S = 30;
  // Orologio di riferimento per il timer "ogni N minuti": invece di un unico
  // setTimer lungo (rallentato/ritardato dai browser quando la tab non è in
  // primo piano), controlliamo spesso se è già passato abbastanza tempo reale.
  const lastScheduledAdAtRef = useRef(Date.now());
  const audioRef = useRef(null);
  const adAudioRef = useRef(null);
  // Web Audio per gli SPOT lato ascoltatore: a differenza di un tag <audio>, l'audio
  // riprodotto via Web Audio NON viene messo in pausa dal "risparmio energia" del browser
  // quando la scheda è in background — che è la causa degli spot "a spezzoni" per chi
  // ascolta a scheda minimizzata.
  const audioCtxRef = useRef(null);
  const spotBuffersRef = useRef({});   // url -> AudioBuffer decodificato
  const spotSourceRef = useRef(null);  // sorgente Web Audio dello spot in corso
  const spotGainRef = useRef(null);    // nodo volume dello spot in corso
  // Loop di silenzio PERPETUO sul contesto Web Audio (avviato al primo click su Play):
  // un contesto che resta in silenzio in una scheda in background può venire sospeso dal
  // browser, e al momento dello spot non riparte (lo spot cadeva sul fallback <audio>,
  // che in background viene bloccato dal risparmio energia). Con questo loop il contesto
  // non è mai "in silenzio", quindi non viene sospeso e lo spot parte sempre.
  const silentLoopRef = useRef(null);
  const wakeLockRef = useRef(null);
  // "Ancora audio": un audio nativo reale (non nell'iframe YouTube) che suona in loop,
  // quasi impercettibile (è un WAV di puro silenzio), mentre si è on air. Il player
  // YouTube è un iframe di terze parti, e i browser lo rallentano/sospendono quando
  // si cambia tab — Wake Lock e Media Session non bastano a evitarlo, perché l'audio
  // "vero" nasce dentro l'iframe, non nella pagina. Un <audio> nativo che suona
  // davvero fa sì che il browser riconosca la tab come "audio attivo" e la penalizzi
  // molto meno in background. ATTIVA ANCHE PER L'ASCOLTATORE (prima solo gestionale):
  // senza un media "udibile" nel frame principale, in background il browser bloccava
  // il play() dell'audio degli SPOT come "video-only background media... paused to
  // save power" — l'iframe YouTube non conta, perché è un altro dominio/frame.
  const keepAliveAudioRef = useRef(null);
  useEffect(() => {
    const a = new Audio("data:audio/wav;base64,UklGRtQEAABXQVZFZm10IBAAAAABAAEAoA8AAKAPAAABAAgAZGF0YbAEAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIA=");
    a.loop = true;
    a.volume = 0.01;
    keepAliveAudioRef.current = a;
    return () => { a.pause(); keepAliveAudioRef.current = null; };
  }, []);
  useEffect(() => {
    if (!keepAliveAudioRef.current) return;
    if (isPlaying) keepAliveAudioRef.current.play().catch(() => {});
    else keepAliveAudioRef.current.pause();
  }, [isPlaying]);
  const ytPlayerRef = useRef(null);
  const [ytReady, setYtReady] = useState(false);

  // Traccia trasmessa dal gestionale via Firebase — è la fonte di verità per la vista pubblica
  const [radioTrack, setRadioTrack] = useState(null);
  // Sempre aggiornato su radioTrack: serve al gestore degli eventi del player YouTube
  // (creato una volta sola) per sapere se in onda c'è un brano mp3 (vedi PAUSED sotto).
  const radioTrackRef = useRef(null);
  radioTrackRef.current = radioTrack;

  // Spot pubblicitario in onda in questo momento, sincronizzato via Firebase (vista pubblica)
  const [adTrack, setAdTrack] = useState(null);
  const wasPlayingBeforeAdRef = useRef(false);
  // Tiene traccia dell'ultimo brano già caricato/posizionato nella vista pubblica,
  // per non ricaricare/riavviare il player quando l'effetto rigira solo per un
  // cambio di isPlaying (evita i conflitti di riproduzione visti all'avvio)
  const lastPublicTrackKeyRef = useRef(null);
  // Tiene traccia dell'ultimo "startedAt" già applicato in vista pubblica per il brano
  // corrente (custom): se il gestionale fa un seek (avanti/indietro) SUL brano stesso,
  // arriva un nuovo startedAt via Firebase pur restando lo stesso brano — questo ref
  // permette di distinguere quel caso e riposizionare l'audio, invece di ignorarlo
  // come un semplice cambio di isPlaying.
  const lastPublicStartedAtRef = useRef(null);
  // Vista pubblica: true se l'ASCOLTATORE ha messo in pausa di sua scelta (pulsante o
  // comando di pausa del sistema). Serve a non farlo ripartire da solo al brano
  // successivo: prima ogni nuovo brano in arrivo da Firebase partiva comunque, anche se
  // l'ascoltatore aveva messo in pausa. Le pause "fantasma" del player (browser in
  // background ecc.) NON lo impostano, quindi in quei casi il brano successivo riparte.
  const userPausedRef = useRef(false);
  // I browser (Safari in particolare) bloccano l'autoplay di un <audio> finché non è
  // stato "sbloccato" da un'interazione utente diretta su QUELL'elemento. Il tag della
  // musica si sblocca quando l'utente preme Play, ma quello degli spot resta bloccato
  // e finora impediva di sentire gli spot arrivati via Firebase. Lo sblocchiamo insieme.
  const adAudioUnlockedRef = useRef(false);
  // true mentre il player YT sta girando in loop muto "di attesa" tra la fine di un
  // brano e l'arrivo del prossimo da Firebase — evita che l'evento PLAYING sintetico
  // di questo loop imposti erroneamente isPlaying/status come se fosse riproduzione vera
  const keepAliveLoopRef = useRef(false);
  // true per una breve finestra subito dopo aver chiamato loadVideoById(): serve a
  // ignorare l'evento PAUSED "fantasma" che l'iframe YouTube a volte emette durante
  // la transizione tra un video e il successivo, prima di arrivare davvero a PLAYING.
  // Senza questo guardiano, quel PAUSED transitorio veniva scambiato per una pausa
  // vera, e l'effetto che segue isPlaying chiamava pauseVideo() bloccando sul serio
  // la riproduzione appena partita (successo sia nel gestionale che in vista pubblica).
  const suppressPauseRef = useRef(false);
  const suppressPauseTimeoutRef = useRef(null);
  // Il player YouTube viene creato UNA SOLA VOLTA (vedi effetto con deps [] più sotto),
  // quindi il suo onStateChange "congela" per sempre la goNext() di quel primissimo
  // render (playlist di fallback, niente shuffle). Come già fatto per
  // playSpotInBackgroundRef, teniamo un ref sempre aggiornato con l'ultima versione
  // di goNext, così l'evento ENDED del player YouTube segue sempre la lista/indice
  // reali al momento in cui il video finisce, anche in modalità casuale.
  const goNextRef = useRef(() => {});
  // Sempre aggiornato su "current": serve a playSpotSolo per capire, nel momento in
  // cui lo spot FINISCE, quale player va davvero ripreso — se nel frattempo (durante
  // lo spot) si è cambiato brano passando da YouTube a un file custom o viceversa,
  // usare il valore "congelato" di quando lo spot è partito farebbe ripartire il
  // player sbagliato (quello vecchio, non più quello attivo) lasciando l'altro fermo.
  const currentRef = useRef(null);
  const armSuppressPause = () => {
    suppressPauseRef.current = true;
    if (suppressPauseTimeoutRef.current) clearTimeout(suppressPauseTimeoutRef.current);
    // Rete di sicurezza: se dopo 2.5s non è arrivato un vero PLAYING (es. autoplay
    // bloccato dal browser), torniamo a fidarci dei PAUSED per non restare "sordi"
    // a un blocco reale che richiede all'utente di premere Play.
    suppressPauseTimeoutRef.current = setTimeout(() => { suppressPauseRef.current = false; }, 2500);
  };

  // Applica il volume alla musica (YouTube + <audio> locale) tenendo conto del "ducking":
  // mentre uno spot è in corso la musica va al 50%, altrimenti al volume pieno. Legge
  // sempre volumeRef.current (valore ATTUALE) e isDuckingRef.current, così è l'unico punto
  // che decide il volume della musica — usato sia quando si sposta lo slider, sia
  // all'avvio/fine di uno spot. Prima questi due casi erano gestiti in punti diversi con
  // valori "fotografati", e bastava un ripristino mancato per lasciare la musica abbassata.
  const applyMusicVolume = () => {
    const factor = isDuckingRef.current ? 0.5 : 1;
    const v = volumeRef.current;
    if (audioRef.current) audioRef.current.volume = Math.max(0, Math.min(1, v * factor));
    ytPlayerRef.current?.setVolume?.(Math.max(0, Math.min(100, v * 100 * factor)));
  };

  // Avvia le "reti di sicurezza" che garantiscono l'esecuzione di restore() UNA sola
  // volta, qualunque cosa ponga fine allo spot: fine naturale (ended), errore di
  // caricamento/riproduzione (error) oppure — rete a tempo — uno spot che non emette mai
  // "ended" (autoplay bloccato, scheda in background che sospende l'<audio>, file
  // corrotto...). Senza queste reti, se "ended" non arrivava il ripristino non avveniva
  // mai: la musica restava abbassata o in pausa per sempre. È esattamente il bug del
  // "volume tagliato che resta anche a spot finito". Ritorna una funzione da chiamare
  // subito se anche il play() iniziale viene rifiutato dal browser.
  const armSpotRestore = (spotAudio, restore) => {
    if (spotSafetyTimerRef.current) { clearTimeout(spotSafetyTimerRef.current); spotSafetyTimerRef.current = null; }
    let done = false;
    const arm = () => {
      if (done) return;
      if (spotSafetyTimerRef.current) clearTimeout(spotSafetyTimerRef.current);
      const dur = isFinite(spotAudio.duration) && spotAudio.duration > 0 ? spotAudio.duration : 45;
      spotSafetyTimerRef.current = setTimeout(finish, (dur + 4) * 1000);
    };
    const finish = () => {
      if (done) return;
      done = true;
      spotAudio.removeEventListener("ended", finish);
      spotAudio.removeEventListener("error", finish);
      spotAudio.removeEventListener("loadedmetadata", arm);
      if (spotSafetyTimerRef.current) { clearTimeout(spotSafetyTimerRef.current); spotSafetyTimerRef.current = null; }
      restore();
    };
    spotAudio.addEventListener("ended", finish);
    spotAudio.addEventListener("error", finish);
    if (isFinite(spotAudio.duration) && spotAudio.duration > 0) arm();
    else {
      spotAudio.addEventListener("loadedmetadata", arm, { once: true });
      // Rete assoluta se nemmeno i metadati arrivano: non lasciare mai lo spot "appeso".
      spotSafetyTimerRef.current = setTimeout(finish, 60000);
    }
    return finish;
  };

  // Determina modalità all'avvio: ?gestionale nell'URL = pannello admin

  // Lista base (jamendo + custom), mai shuffled
  const baseList = useMemo(() => [...tracks, ...customTracks], [tracks, customTracks]);

  // Quando cambiano i brani o si attiva/disattiva shuffle, ricalcola shuffledList UNA volta sola
  useEffect(() => {
    if (shuffleMode) {
      setShuffledList(shuffleArray(baseList));
      setCurrentIndex(0);
    }
  }, [shuffleMode, baseList]);

  // La lista effettiva da usare
  const allTracks = shuffleMode ? shuffledList : baseList;

  const filtered = category === "Tutti"
    ? allTracks
    : category === "Le mie canzoni"
    ? (shuffleMode ? shuffledList.filter(t => t.isCustom) : customTracks)
    : allTracks.filter((t) => t.category === category);

  const current = filtered[currentIndex] || filtered[0];
  useEffect(() => { currentRef.current = current; });

  // Vista radio pubblica: precarica in anticipo tutti i file degli spot (invece di
  // scaricarli solo nel momento in cui arriva l'evento da Firebase). Senza questo,
  // ogni spot partiva con un ritardo di caricamento variabile (rete/dimensione file),
  // ritardo che poi la logica di sincronizzazione interpretava come "tempo già
  // trascorso" e recuperava saltando in avanti — cioè lo spot arrivava tagliato
  // all'inizio. Precaricando, quando lo spot parte davvero il file è già in cache
  // del browser e la riproduzione può iniziare quasi istantaneamente.
  useEffect(() => {
    // Precarica per TUTTI (anche gestionale): così quando uno spot parte, il file è già
    // in cache e il play può avvenire a file pronto anche a scheda in background.
    const preloaded = AD_SPOTS.map((url) => {
      const a = new Audio();
      a.preload = "auto";
      a.src = url;
      a.load();
      return a;
    });
    // Precarica anche i buffer Web Audio (solo ascoltatore): la DECODIFICA non richiede
    // alcun gesto utente (serve solo per far *partire* l'audio), quindi possiamo farla
    // subito all'apertura. Così quando arriva uno spot il percorso Web Audio è già
    // pronto, anche se l'utente ha premuto Play molto tempo prima o la scheda è finita
    // in background.
    if (!isGestionale) AD_SPOTS.forEach((u) => loadSpotBuffer(u));
    return () => { preloaded.forEach((a) => { a.src = ""; }); };
  }, [isGestionale]);


  // corso, il "pulisci adPlaying alla fine dello spot" (evento "ended") non fa in
  // tempo a scattare, e quello spot resta scritto su Firebase per sempre: i prossimi
  // ascoltatori che si collegano lo trovano ancora lì e lo sentono partire "da solo".
  // onDisconnect fa pulire il nodo lato server non appena Firebase rileva che questo
  // client si è disconnesso, quale che sia il motivo (crash, chiusura tab, rete).
  //
  // Le pulizie vengono registrate SOLO dopo che QUESTA scheda ha davvero trasmesso
  // (primo Play): prima venivano registrate appena si apriva il gestionale, quindi
  // aprire una seconda scheda del gestionale (o dal telefono) e poi chiuderla spegneva
  // la diretta che stava andando dall'altra scheda.
  const [hasBroadcast, setHasBroadcast] = useState(false);
  useEffect(() => { if (isGestionale && isPlaying) setHasBroadcast(true); }, [isGestionale, isPlaying]);
  //
  // Stessa protezione anche per "nowPlaying": se il gestionale si disconnette (chiude
  // la tab, crash, perde la rete) senza aver messo in pausa, il nodo "nowPlaying"
  // altrimenti resterebbe scritto per sempre con l'ultimo brano trasmesso, e la
  // vista pubblica continuerebbe a risultare "LIVE" anche se non trasmette più nessuno.
  //
  // Firebase esegue queste pulizie UNA volta sola: dopo un buco di rete del gestionale
  // non erano più attive. Ora le registriamo di nuovo ad ogni (ri)connessione, e alla
  // riconnessione ripubblichiamo subito il brano in onda col punto reale, così gli
  // ascoltatori ritrovano la diretta senza aspettare il battito dei 15 secondi.
  useEffect(() => {
    if (!isGestionale || !hasBroadcast) return;
    const npRef = ref(db, "nowPlaying");
    const adRef = ref(db, "adPlaying");
    let wasConnected = false;
    const unsub = onValue(ref(db, ".info/connected"), (snapshot) => {
      if (snapshot.val() !== true) return;
      onDisconnect(npRef).set(null);
      onDisconnect(adRef).set(null);
      const isReconnect = wasConnected;
      wasConnected = true;
      if (!isReconnect || !isPlayingRef.current) return;
      const c = currentRef.current;
      if (!c) return;
      const t = c.isCustom
        ? (audioRef.current?.currentTime || 0)
        : (ytPlayerRef.current?.getCurrentTime?.() || 0);
      publishNowPlaying(c, t);
    });
    return () => {
      unsub();
      onDisconnect(npRef).cancel();
      onDisconnect(adRef).cancel();
    };
  }, [isGestionale, hasBroadcast]);

  // Carica canzoni da public/my-song/index.json
  useEffect(() => {
    fetch("/my-song/index.json")
      .then((r) => { if (!r.ok) throw new Error("no file"); return r.json(); })
      .then((list) => {
        const loaded = list.map((item, i) => ({
          id: "custom_static_" + i,
          title: item.title || item.file.replace(/\.[^/.]+$/, ""),
          artist: item.artist || "La mia musica",
          category: "Le mie canzoni",
          url: "/my-song/" + item.file,
          color: MY_SONGS_COLOR,
          isCustom: true,
          fileName: item.file,
        }));
        setCustomTracks(loaded);
      })
      .catch(() => {});
  }, []);

  // Carica automaticamente i brani più ascoltati in Europa (Italia compresa), Stati Uniti e America Latina da
  // YouTube Data API v3: per ogni paese sia "del momento" (classifica del paese) sia
  // "di sempre" (ordinati per view totali). Risultati cachati in localStorage per 18
  // ore per non consumare quota Google.
  useEffect(() => {
    // SOLO il gestionale interroga l'API YouTube: è l'unico che deve scegliere i brani.
    // Gli ascoltatori ricevono TUTTO da Firebase (brano + spot) e non usano affatto questa
    // lista, quindi non devono consumare quota. Prima invece OGNI visitatore faceva 8
    // ricerche: con la chiave condivisa era la causa principale dell'esaurimento rapido
    // della quota giornaliera ("Search Queries per day" al 100%).
    if (!isGestionale) { setLoadingTracks(false); return; }
    if (!YOUTUBE_API_KEY) {
      setLoadError("Imposta VITE_YOUTUBE_API_KEY nelle variabili Cloudflare. Uso playlist di riserva.");
      setLoadingTracks(false);
      return;
    }

    // Chiave nuova: la cache vecchia conteneva la playlist globale per generi (con i
    // brani indiani/russi ecc.) e non deve essere riusata.
    const CACHE_KEY = "rp_yt_cache_eu_am_v5"; // v5: esclusi anche dalla lingua dell'audio/descrizione (es. punjabi in GB)
    // Alzata da 4 a 18 ore: con la chiave condivisa tra tutti i visitatori, ogni
    // scadenza cache moltiplicata per tanti browser è proprio ciò che genera le
    // raffiche che fanno scattare rateLimitExceeded (vedi anche il fix sotto sullo
    // scaglionamento delle chiamate).
    const CACHE_TTL = 18 * 60 * 60 * 1000;

    // Prova a leggere dalla cache
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const { tracks: cached, label, ts } = JSON.parse(raw);
        if (Date.now() - ts < CACHE_TTL && cached?.length) {
          setTracks(cached);
          setLoadError(label);
          setLoadingTracks(false);
          return; // ← nessuna chiamata API, usiamo la cache
        }
      }
    } catch (_) { /* cache corrotta, ignora e rifai il fetch */ }

    const colorFor = (() => {
      const map = {};
      let i = 0;
      return (cat) => {
        if (!map[cat]) { map[cat] = COLOR_PALETTE[i % COLOR_PALETTE.length]; i++; }
        return map[cat];
      };
    })();

    // Niente più ricerche per genere su scala globale (regionCode=US): erano quelle a
    // tirare dentro brani indiani, russi, asiatici ecc. che nessun filtro riusciva a
    // bloccare del tutto. Ora la playlist nasce direttamente dalle classifiche dei
    // paesi europei (Italia compresa), degli Stati Uniti e dell'America Latina: per
    // ogni paese prendiamo sia i più ascoltati
    // DEL MOMENTO (classifica musicale YouTube del paese) sia quelli DI SEMPRE
    // (ricerca ordinata per visualizzazioni totali, ristretta a paese e lingua).
    // Germania tolta di proposito: niente canzoni tedesche.
    const SOURCES = [
      { label: "Italia",          region: "IT", lang: "it", query: "canzoni italiane" },
      { label: "Internazionali",  region: "GB", lang: "en", query: "pop hits" },
      { label: "Spagna",          region: "ES", lang: "es", query: "canciones españolas" },
      { label: "Francia",         region: "FR", lang: "fr", query: "chanson française" },
      { label: "Americane",       region: "US", lang: "en", query: "american pop hits" },
      { label: "Latine",          region: "MX", lang: "es", query: "musica latina reggaeton" },
    ];
    const PER_SLICE = 15;

    // "Del momento" = pubblicati nell'ultimo anno (usato solo se la classifica del
    // paese non è disponibile e si ripiega sulla ricerca).
    const trendingSince = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();

    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

    // Riprova con backoff SOLO sui 429 (rateLimitExceeded): quello è transitorio e a
    // volte basta aspettare un attimo perché la raffica di richieste (nostre o di
    // altri visitatori sulla stessa chiave) si diradi. Su altri errori (chiave
    // invalida, API non abilitata, quota giornaliera esaurita) non ha senso riprovare.
    const fetchJsonWithRetry = (url, label, attempt = 0) =>
      fetch(url).then((r) => {
        if (r.status === 429 && attempt < 2) {
          const wait = 1200 * (attempt + 1) + Math.random() * 500;
          return sleep(wait).then(() => fetchJsonWithRetry(url, label, attempt + 1));
        }
        if (!r.ok) {
          return r.json().catch(() => null).then((body) => {
            const reason = body?.error?.errors?.[0]?.reason || body?.error?.message || r.status;
            throw new Error(`YouTube API [${label}] fallita: ${reason}`);
          });
        }
        return r.json();
      });

    // Filtro di sicurezza sui risultati (ora \u00E8 solo una rete di riserva: le fonti sono
    // gi\u00E0 europee) + conversione nel formato brano della radio.
          // Blocca i titoli/canali scritti in alfabeti non latini: cirillico (russo ecc.),
          // armeno, georgiano, ebraico, indiani (devanagari,
          // bengali, gurmukhi, gujarati, oriya, tamil, telugu, kannada, malayalam,
          // singalese), sud-est asiatico (thai, lao, khmer, birmano), Asia orientale
          // (CJK, hangul, kana), arabo (con forme di presentazione) ed etiope.
          const hasNonLatin = (str) => /[\u0400-\u052F\u0530-\u058F\u0590-\u05FF\u10A0-\u10FF\u0600-\u06FF\u0750-\u077F\u0900-\u097F\u0980-\u09FF\u0A00-\u0A7F\u0A80-\u0AFF\u0B00-\u0B7F\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F\u0D80-\u0DFF\u0E00-\u0E7F\u0E80-\u0EFF\u0F00-\u0FFF\u1000-\u109F\u1100-\u11FF\u1200-\u137F\u1780-\u17FF\u3000-\u9FFF\uA000-\uA48F\uAC00-\uD7AF\uF900-\uFAFF\uFB50-\uFDFF\uFE70-\uFEFF\u3400-\u4DBF]/.test(str);
          // Titoli/canali di musica indiana, asiatica o africana spesso traslitterati in
          // caratteri latini (quindi invisibili a hasNonLatin, che guarda solo
          // l'alfabeto): li intercettiamo per parole chiave esplicite, a parola intera
          // per non colpire titoli occidentali legittimi.
          const FOREIGN_KEYWORDS = new RegExp("\\b(" + [
            // India / subcontinente
            "bollywood", "tollywood", "kollywood", "hindi", "punjabi", "bhojpuri", "bhajan",
            "bhangra", "desi", "tamil", "telugu", "kannada", "malayalam", "marathi",
            "gujarati", "odia", "assamese", "hindustani", "carnatic", "qawwali",
            "urdu", "pakistani", "bangla", "bangladeshi", "nepali", "sinhala", "sri lankan",
            "indian song", "indian songs", "indian music",
            // Asia orientale / sud-est asiatico / Asia centrale
            "k-?pop", "kdrama", "korean drama", "korean song", "korean music",
            "mandarin", "cantonese", "chinese song", "chinese music", "c-?pop",
            "j-?pop", "japanese song", "japanese music", "anime opening", "anime ending",
            "dangdut", "indonesian song", "bahasa", "malay song", "tagalog", "filipino",
            "pinoy", "thai song", "thai music", "vietnamese song", "vietnamese music",
            "khmer", "myanmar song", "mongolian song", "kazakh", "uzbek",
            "turkish song", "turkish music", "arabic", "arab song", "persian", "farsi",
            "iranian", "afghan",
            // Etichette/canali indiani con miliardi di view: spuntano soprattutto nelle
            // ricerche "di sempre" sugli Stati Uniti, dove i titoli sono spesso in inglese.
            "t-series", "tseries", "zee music", "saregama", "sony music india",
            "speed records", "tips official", "yrf", "aditya music", "lahari", "shemaroo",
            // Musica punjabi, molto ascoltata nel Regno Unito: entra dalla classifica
            // "Internazionali" (GB) con titoli in inglese e senza parole rivelatrici.
            "white hill", "geet mp3", "jass records", "desi melodies", "saga music",
            "humble music", "times music", "tips punjabi", "vyrl", "rehaan records",
            "brown boys", "sidhu moose wala", "ap dhillon", "karan aujla", "diljit dosanjh",
            // Russia / area ex sovietica (titoli traslitterati in caratteri latini)
            "russian", "russkaya", "russkie", "pesni",
            // Africa
            "afrobeat", "afrobeats", "amapiano", "naija", "nigerian", "ghanaian",
            "kenyan", "tanzanian", "ugandan", "congolese", "senegalese", "swahili",
            "yoruba", "igbo", "hausa", "zulu", "xhosa", "amharic", "ethiopian",
            "eritrean", "soukous", "bongo flava", "gqom", "kwaito", "highlife",
            "azonto", "african song", "african music", "afro pop", "afropop",
          ].join("|") + ")\\b");
          const isForeignLatin = (str) => FOREIGN_KEYWORDS.test(str.toLowerCase());
    const toTracks = (items, label, getVideoId) => {
          const isSpam = (title) => {
            if (title.length > 80) return true;
            const t = title.toLowerCase();
            return (
              /\bfeat\.?.*feat\.?\b/.test(t) ||
              /\b(subscribe|follow|like|download|stream|out now|available now|new song|new video|latest|lyric video|lyrics video|audio only|visualizer|topic)\b/.test(t) ||
              /\b(nonstop|non stop|jukebox|playlist|mashup|medley|mixtape|compilation|top \d+)\b/.test(t) ||
              /\b(full album|full movie|episode|trailer|teaser|bts|behind the scene)\b/.test(t) ||
              /\b(how to|tutorial|lesson|corso|come si|come fare|come registrare|come suonare|beginner|imparare|budget|low cost|cheap)\b/.test(t) ||
              /^(come|how|tutorial|lezione|guida|recensione|review|unboxing)\b/.test(t) ||
              // Spot pubblicitari / presentazioni che si infilano tra i risultati musicali:
              /\b(spot pubblicitario|pubblicit[aà]|presentazione aziendale|presentazione ufficiale|commercial|advertisement|advert|promo video|company profile|corporate video|jingle|sigla)\b/.test(t) ||
              (title.match(/#\w+/g) || []).length >= 2 ||
              (title.match(/[|•·—–]/g) || []).length >= 2 ||
              /\d{4}.*\d{4}/.test(t)
            );
          };
          return (items || [])
            .filter((it) => {
              const title = it.snippet.title;
              const channel = it.snippet.channelTitle;
              return !hasNonLatin(title) && !hasNonLatin(channel) && !isSpam(title)
                && !isForeignLatin(title) && !isForeignLatin(channel);
            })
            .map((it) => ({
              id: getVideoId(it) + "_" + label,
              videoId: getVideoId(it),
              title: it.snippet.title,
              artist: it.snippet.channelTitle,
              category: label,
              color: colorFor(label),
              isCustom: false,
              url: null,
            }));
    };

    // Più ascoltati DI SEMPRE nel paese: ricerca ordinata per visualizzazioni totali,
    // ristretta alla regione e alla lingua del paese.
    const searchSlice = ({ label, region, lang, query }, publishedAfter) => {
      const q = encodeURIComponent(`${query} official music video`);
      let url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${q}&type=video&videoCategoryId=10&videoEmbeddable=true&order=viewCount&maxResults=${PER_SLICE}&regionCode=${region}&relevanceLanguage=${lang}&key=${YOUTUBE_API_KEY}`;
      if (publishedAfter) url += `&publishedAfter=${publishedAfter}`;
      return fetchJsonWithRetry(url, label)
        .then((data) => toTracks(data.items, label, (it) => it.id.videoId))
        .catch((err) => { console.warn(err.message || err); return []; });
    };

    // Più ascoltati DEL MOMENTO nel paese: classifica musicale di YouTube per quella
    // regione (costa 1 unità di quota invece delle 100 di una ricerca). Se per quel
    // paese la classifica non è disponibile, ripiega su una ricerca per visualizzazioni
    // limitata ai brani dell'ultimo anno.
    const chartSlice = (source) => {
      const { label, region } = source;
      const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet,status&chart=mostPopular&videoCategoryId=10&regionCode=${region}&maxResults=${PER_SLICE}&key=${YOUTUBE_API_KEY}`;
      return fetchJsonWithRetry(url, label)
        // Scarta i video che il proprietario non permette di riprodurre fuori da YouTube
        // (frequenti tra i video ufficiali in classifica): nel player darebbero errore
        // 101/150 e verrebbero saltati a raffica.
        .then((data) => toTracks((data.items || []).filter((it) => it.status?.embeddable !== false), label, (it) => it.id))
        .catch((err) => { console.warn(err.message || err); return []; })
        .then((list) => (list.length ? list : searchSlice(source, trendingSince)));
    };

    const fetchSlice = (source) => Promise.all([chartSlice(source), searchSlice(source, null)])
      .then(([momento, sempre]) => [...momento, ...sempre]);

    // Le richieste NON partono tutte insieme: le scaglioniamo di ~300ms l'una
    // dall'altra. Sparare tutti i fetch in un colpo solo (moltiplicato per tutti i visitatori
    // che aprono la radio nello stesso momento, sulla stessa chiave API) è proprio ciò
    // che generava le raffiche dietro il rateLimitExceeded (429) osservato in console.
    const STAGGER_MS = 300;
    const runStaggered = async (items, fn, ms) => {
      const promises = [];
      for (let i = 0; i < items.length; i++) {
        if (i > 0) await sleep(ms);
        promises.push(fn(items[i]));
      }
      return Promise.all(promises);
    };

    // Controllo finale di riproducibilità, su TUTTI i brani (ricerca + classifica): il
    // solo "incorporabile" non basta. Un video può esserlo ed essere comunque bloccato in
    // Italia (capita coi brani delle classifiche USA/Messico), vietato ai minori (negli
    // embed non parte) o non pubblico: nel player darebbe errore e verrebbe saltato.
    // Una richiesta ogni 50 brani, 1 unità di quota l'una. Se il controllo fallisce
    // teniamo i brani così come sono, invece di restare senza playlist.
    const PLAY_REGION = "IT";
    const isPlayableHere = (v) => {
      if (v.status?.embeddable === false) return false;
      if (v.status?.privacyStatus && v.status.privacyStatus !== "public") return false;
      if (v.contentDetails?.contentRating?.ytRating === "ytAgeRestricted") return false;
      const rr = v.contentDetails?.regionRestriction;
      if (rr?.allowed && !rr.allowed.includes(PLAY_REGION)) return false;
      if (rr?.blocked && rr.blocked.includes(PLAY_REGION)) return false;
      return true;
    };
    // Lingue dell'audio dichiarate da YouTube che non vogliamo: indiane, russe/ex URSS,
    // asiatiche, arabe/mediorientali, africane e tedesco (scelta del proprietario).
    const BLOCKED_LANGS = new Set([
      "hi", "pa", "ta", "te", "ml", "kn", "mr", "bn", "gu", "ur", "ne", "si", "or", "as", "bho", "sa",
      "ru", "uk", "be", "kk", "uz", "ky", "tg", "az",
      "ko", "ja", "zh", "th", "vi", "id", "ms", "tl", "fil", "km", "lo", "my", "mn",
      "ar", "fa", "tr", "ps", "ku", "he",
      "am", "sw", "yo", "ig", "ha", "zu", "xh",
      "de",
    ]);
    // Brani "stranieri" che hanno titolo e canale in caratteri latini e senza parole
    // rivelatrici (tipico della musica punjabi nella classifica del Regno Unito): li
    // riconosciamo dalla lingua dell'audio dichiarata su YouTube, e dalla descrizione e
    // dalle etichette del video, dove di solito compaiono testi in alfabeto indiano o
    // parole come "Punjabi song".
    const isForeignByDetails = (v) => {
      const lang = String(v.snippet?.defaultAudioLanguage || v.snippet?.defaultLanguage || "").toLowerCase().split("-")[0];
      if (BLOCKED_LANGS.has(lang)) return true;
      const text = [v.snippet?.description || "", ...(v.snippet?.tags || [])].join(" ");
      return hasNonLatin(text) || isForeignLatin(text);
    };
    const keepPlayable = (list) => {
      const chunks = [];
      for (let i = 0; i < list.length; i += 50) chunks.push(list.slice(i, i + 50));
      return Promise.all(chunks.map((chunk) => {
        const ids = chunk.map((t) => t.videoId).join(",");
        const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet,status,contentDetails&id=${ids}&maxResults=50&key=${YOUTUBE_API_KEY}`;
        return fetchJsonWithRetry(url, "verifica")
          .then((data) => {
            const okIds = new Set((data.items || []).filter((v) => isPlayableHere(v) && !isForeignByDetails(v)).map((v) => v.id));
            // Un id che non torna proprio nella risposta è un video rimosso/privato.
            return chunk.filter((t) => okIds.has(t.videoId));
          })
          .catch((err) => { console.warn(err.message || err); return chunk; });
      })).then((parts) => parts.flat());
    };

    runStaggered(SOURCES, fetchSlice, STAGGER_MS)
      .then((arrays) => {
        const mapped = arrays.flat();
        if (!mapped.length) throw new Error("Nessun brano trovato");
        // Rimuove duplicati per videoId (stesso video in più paesi o classifiche)
        const seen = new Set();
        return keepPlayable(mapped.filter((t) => {
          if (seen.has(t.videoId)) return false;
          seen.add(t.videoId);
          return true;
        }));
      })
      .then((deduped) => {
        if (!deduped.length) throw new Error("Nessun brano riproducibile trovato");
        const label = "🔥 Più ascoltati in Europa, America e America Latina: del momento e di sempre";
        // Salva in cache
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify({ tracks: deduped, label, ts: Date.now() }));
        } catch (_) { /* quota localStorage piena, ignora */ }
        setTracks(deduped);
        setLoadError(label);
        setLoadingTracks(false);
      })
      .catch((err) => {
        console.warn("Caricamento brani YouTube fallito del tutto:", err.message || err);
        setLoadError("Impossibile caricare i brani da YouTube. Uso playlist di riserva.");
        setLoadingTracks(false);
      });
  }, []);

  // Carica lo script IFrame API di YouTube e crea il player una sola volta
  useEffect(() => {
    function createPlayer() {
      ytPlayerRef.current = new window.YT.Player("yt-player", {
        height: "84",
        width: "84",
        videoId: YOUTUBE_FALLBACK_TRACKS[0]?.videoId,
        playerVars: { controls: 0, disablekb: 1, modestbranding: 1, rel: 0 },
        events: {
          onReady: () => { ytPlayerRef.current.setVolume(volume * 100); setYtReady(true); },
          onStateChange: (e) => {
            // goNext() (avanzamento al brano successivo) deve girare SOLO nel gestionale:
            // in vista pubblica l'avanzamento è governato da Firebase, non dalla fine del
            // video locale, altrimenti si disallineerebbe la trasmissione.
            if (e.data === window.YT.PlayerState.ENDED) {
              if (isGestionale) {
                goNextRef.current();
              } else {
                // Vista pubblica: se lasciamo il player davvero "fermo" mentre aspettiamo
                // il prossimo brano da Firebase, il successivo loadVideoById verrebbe
                // bloccato dall'autoplay del browser (l'iframe YouTube è un dominio diverso,
                // il click sul nostro Play non lo sblocca in modo permanente). Lo teniamo
                // "vivo" in loop silenzioso finché non arriva il brano vero.
                keepAliveLoopRef.current = true;
                ytPlayerRef.current?.mute?.();
                ytPlayerRef.current?.seekTo?.(0, true);
                ytPlayerRef.current?.playVideo?.();
              }
            }
            if (e.data === window.YT.PlayerState.PLAYING) {
              suppressPauseRef.current = false; // arrivato un PLAYING vero: la transizione è conclusa
              if (suppressPauseTimeoutRef.current) { clearTimeout(suppressPauseTimeoutRef.current); suppressPauseTimeoutRef.current = null; }
              if (keepAliveLoopRef.current) {
                // NON consumiamo il flag: resta attivo per TUTTA l'attesa del brano
                // successivo (viene azzerato solo dall'effetto radioTrack quando il brano
                // vero viene caricato). Prima veniva azzerato al primo PLAYING del loop:
                // così un SECONDO evento PLAYING dentro l'attesa (es. ripresa dopo un
                // buffering) finiva nel ramo else, che lo SMUTAVA — ed è per questo che
                // il "replay" del brano appena finito a volte si sentiva invece di
                // restare silenzioso. In più, con il flag attivo anche i PAUSED del loop
                // di attesa restano ignorati (vedi condizione del PAUSED più sotto),
                // quindi la radio non si incastra più "in pausa" a fine brano.
                ytPlayerRef.current?.mute?.(); // ribadisci il muto: l'attesa è SEMPRE silenziosa
              } else {
                ytErrorCountRef.current = 0; // un brano è partito davvero: azzera il freno anti-raffica
                // RETE DI SICUREZZA (radio pubblica): ogni volta che parte un brano VERO,
                // forziamo lo smuto del player. Tra un brano e l'altro il player viene
                // messo in loop MUTO d'attesa (vedi ENDED sopra); se per una qualsiasi
                // sovrapposizione di eventi quel muto non veniva tolto, il brano nuovo
                // ripartiva senza audio (e la scheda non mostrava più l'icona altoparlante).
                // Qui lo togliamo sempre. Nel gestionale NON lo facciamo, per non
                // scavalcare il pulsante "Muto generale".
                if (!isGestionale) {
                  ytPlayerRef.current?.unMute?.();
                  applyMusicVolume(); // rispetta il ducking se c'è uno spot in corso
                }
                setStatus("In riproduzione");
                setIsPlaying(true);
              }
            }
            if (e.data === window.YT.PlayerState.PAUSED && !keepAliveLoopRef.current && !suppressPauseRef.current) {
              if (isGestionale) {
                // Gestionale: l'unica pausa VERA è quella del pulsante, che imposta
                // isPlaying=false PRIMA di pausare il player (quindi qui isPlayingRef è già
                // false). Se invece isPlayingRef è ancora true, è un PAUSED "spurio"
                // (buffering, transizione, pubblicità YouTube, throttling della scheda):
                // lo IGNORIAMO del tutto. Prima qui chiamavo playVideo() per "recuperare",
                // ma se il player stava solo bufferando quel play ripetuto causava lo
                // stutter "a spezzoni". Al ritorno in primo piano ci pensa il gestore di
                // visibilitychange a riprendere; per un buffering, YouTube riparte da solo.
                if (!isPlayingRef.current) setStatus("In pausa");
              } else if (radioTrackRef.current?.isCustom) {
                // In onda c'è un brano mp3 ("Le mie canzoni"): YouTube non è il player
                // attivo, e questo PAUSED è solo la conseguenza del pauseVideo() con cui lo
                // fermiamo al passaggio YouTube → mp3. Prima veniva preso per una pausa
                // dell'ascoltatore: se il gestionale passava a "Giulia" a metà di un brano
                // YouTube, la radio si fermava e l'ascoltatore doveva ripremere Play.
              } else {
                setStatus("In pausa");
                setIsPlaying(false);
              }
            }
          },
          // Video non riproducibile: errori YouTube tipici 101/150 (embed disabilitato dal
          // proprietario — FREQUENTE sui video musicali ufficiali), 100 (rimosso/privato),
          // 2/5 (id/player non validi). Passiamo al successivo, ma CON UN FRENO: senza,
          // una serie di video non incorporabili di fila fa saltare tutta la playlist a
          // raffica, senza mai suonare né sul gestionale né sulla radio ("non segue
          // l'ordine, si ferma e ricomincia, non si sente nulla").
          onError: (e) => {
            if (!isGestionale) return;
            const now = Date.now();
            // Errori entro 12s l'uno dall'altro = "raffica": li contiamo. Errori isolati
            // (>12s) ripartono da 1, così un video morto ogni tanto si salta senza problemi.
            ytErrorCountRef.current = (now - ytLastErrorAtRef.current < 12000) ? ytErrorCountRef.current + 1 : 1;
            ytLastErrorAtRef.current = now;
            if (ytErrorCountRef.current > 5) {
              // Troppi brani non incorporabili di fila: invece di raffichare facciamo una
              // pausa di 30 secondi e poi riproviamo col successivo. Prima qui la radio si
              // FERMAVA del tutto (isPlaying=false) e restava ferma finché qualcuno non
              // tornava sulla pagina a premere Play: un'altra "pausa da sola" a scheda in
              // background. Se nel frattempo il gestore preme Pausa, non si riparte.
              setStatus("Diversi brani di fila non sono incorporabili da YouTube — riprovo tra 30 secondi…");
              ytErrorCountRef.current = 0;
              setTimeout(() => { if (isPlayingRef.current) goNextRef.current(); }, 30000);
              return;
            }
            setStatus("Brano non disponibile, passo al prossimo…");
            // Piccolo ritardo: niente loop stretto, e diamo respiro all'iframe.
            setTimeout(() => { goNextRef.current(); }, 700);
          },
        },
      });
    }

    if (window.YT && window.YT.Player) {
      createPlayer();
    } else {
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      document.body.appendChild(tag);
      window.onYouTubeIframeAPIReady = createPlayer;
    }
  }, []);

  // Categorie derivate sempre in modo reattivo, senza state separato
  const categories = useMemo(() => {
    const genreCats = [...new Set(tracks.map((t) => t.category))];
    const cats = ["Tutti", ...genreCats];
    if (customTracks.length > 0) cats.push("Le mie canzoni");
    return cats;
  }, [tracks, customTracks]);

  useEffect(() => { setCurrentIndex(0); }, [category]);

  // Il gestionale è l'unico che decide QUANDO parte uno spot in sottofondo (ogni 2 minuti
  // di trasmissione) e lo pubblica su Firebase tramite publishAdPlaying (dentro
  // playSpotInBackground), così tutti gli ascoltatori lo sentono nello stesso istante.
  // In vista pubblica questo intervallo NON esiste: gli ascoltatori reagiscono solo
  // all'evento "adPlaying" da Firebase (vedi l'effetto più sotto che ascolta adTrack).
  //
  // IMPORTANTE: playSpotInBackgroundRef punta sempre all'ultima versione della funzione
  // (aggiornato ad ogni render, sotto). Questo permette all'intervallo di NON dipendere
  // da volume/adVolume: se dipendesse da quei valori, ogni volta che il gestore sposta
  // uno slider (volume generale o volume spot) l'intervallo verrebbe distrutto e
  // ricreato da capo, azzerando il countdown dei 2 minuti — è esattamente questo che
  // faceva sembrare lo spot "non partire mai": bastava toccare il volume per farlo
  // ripartire da zero ogni volta.
  const playSpotInBackgroundRef = useRef(() => {});
  useEffect(() => { playSpotInBackgroundRef.current = playSpotInBackground; });
  useEffect(() => {
    if (!isGestionale) return;
    // NOTA: non si controlla isMutedRef qui. Il muto generale del gestionale deve
    // silenziare SOLO l'ascolto locale (vedi effetto che imposta audio.muted), non
    // deve impedire allo spot di partire e di essere pubblicato su Firebase: altrimenti
    // il gestore che si muta in loco spegnerebbe lo spot anche per la radio pubblica.
    // Controlliamo ogni 10 secondi se è già trascorso il tempo impostato, invece di
    // affidarci a un singolo timer lungo: i browser rallentano/ritardano parecchio i
    // timer di diversi minuti quando la tab non è in primo piano, mentre un controllo
    // frequente basato sull'orologio reale (Date.now) recupera subito il ritardo non
    // appena il browser lo lascia girare di nuovo, invece di perdere lo scatto.
    lastScheduledAdAtRef.current = Date.now();
    let lastTick = Date.now();
    return startTicker(() => {
      const now = Date.now();
      if (!isPlayingRef.current || !adEvery2MinEnabled) {
        // Il tempo passato in PAUSA non conta: spostiamo avanti il punto di partenza.
        // Prima contava anche quello, quindi con la pagina aperta da più di N minuti
        // (o dopo una pausa lunga) lo spot partiva pochi secondi dopo aver premuto Play.
        lastScheduledAdAtRef.current += now - lastTick;
        lastTick = now;
        return;
      }
      lastTick = now;
      const elapsedMs = now - lastScheduledAdAtRef.current;
      // NON azzeriamo qui l'orologio: lo fa playSpotInBackground solo se lo spot parte
      // davvero. Prima veniva azzerato anche quando lo spot veniva scartato (spot
      // precedente ancora in corso o finito da meno di 30 secondi), e così saltava un
      // giro intero: lo spot successivo arrivava dopo il doppio del tempo impostato.
      // Ora, se viene scartato, si riprova al controllo successivo (10 secondi dopo).
      if (elapsedMs >= Math.max(1, adIntervalMinutes) * 60000) {
        playSpotInBackgroundRef.current();
      }
    }, 10000);
  }, [adEvery2MinEnabled, adIntervalMinutes, isGestionale]);

  // Applica il mute generale agli elementi audio reali: musica (HTML5 o YouTube) e spot.
  // Questo copre anche l'eventuale spot già in corso nel momento in cui si preme mute.
  useEffect(() => {
    if (audioRef.current) audioRef.current.muted = isMuted;
    if (adAudioRef.current) adAudioRef.current.muted = isMuted;
    if (ytPlayerRef.current) {
      if (isMuted) ytPlayerRef.current.mute?.();
      else ytPlayerRef.current.unMute?.();
    }
  }, [isMuted]);

  useEffect(() => {
    const id = setInterval(() => setAdLine((a) => (a + 1) % AD_LINES.length), 6000);
    return () => clearInterval(id);
  }, []);

  // Ref che tiene traccia se vogliamo riprodurre appena il brano è pronto
  const shouldPlayRef = useRef(false);
  // Traccia l'eventuale Promise di play() ancora "in volo" sul tag <audio> dei brani
  // locali/custom. Chiamare pause() (o cambiare src) mentre quella promise non si è
  // ancora risolta è una nota causa di comportamento imprevedibile nei browser: a
  // volte la pausa viene ignorata e l'audio riparte da solo appena la vecchia play()
  // si risolve. Era proprio questo a rendere "incontrollabile" il player dopo uno
  // skip sui brani locali (index.json). Queste due funzioni aspettano sempre che una
  // play() pendente si concluda prima di eseguire la prossima operazione.
  const playPromiseRef = useRef(null);
  const safePlayAudio = (audio) => {
    const p = audio.play();
    playPromiseRef.current = p;
    if (p && p.then) {
      const clear = () => { if (playPromiseRef.current === p) playPromiseRef.current = null; };
      p.then(clear).catch(clear);
    }
    return p;
  };
  const safePauseAudio = (audio) => {
    if (playPromiseRef.current) {
      playPromiseRef.current.then(() => audio.pause()).catch(() => audio.pause());
    } else {
      audio.pause();
    }
  };

  // Quando cambia il volume: passa da applyMusicVolume, che tiene conto del ducking, così
  // spostare lo slider MENTRE uno spot è in corso non riporta la musica a tutto volume.
  useEffect(() => {
    applyMusicVolume();
  }, [volume]);

  // ─── Wake Lock: impedisce che lo schermo si spenga/blocchi per inattività mentre
  // la radio sta suonando (sia gestionale che ascoltatore). IMPORTANTE: questo NON
  // impedisce una vera sospensione manuale del PC (coperchio chiuso, "sospendi" dal
  // menu, spegnimento) — quello è deciso dal sistema operativo e nessun sito web può
  // evitarlo. Il Wake Lock evita solo lo spegnimento automatico dello schermo per
  // inattività, che è la causa più comune dell'interruzione ("si spegne lo schermo
  // e si ferma"). Supportato da Chrome/Edge/Android; su Safari/iOS il supporto è
  // parziale o assente, in quel caso la richiesta fallisce silenziosamente.
  useEffect(() => {
    if (!("wakeLock" in navigator)) return;
    let cancelled = false;

    const requestWakeLock = async () => {
      try {
        const lock = await navigator.wakeLock.request("screen");
        if (cancelled) { lock.release().catch(() => {}); return; }
        wakeLockRef.current = lock;
      } catch (e) {
        console.warn("Wake Lock non ottenuto:", e.message);
      }
    };
    const releaseWakeLock = () => {
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
    };

    if (isPlaying) requestWakeLock();
    else releaseWakeLock();

    return () => { cancelled = true; };
  }, [isPlaying]);

  // Il Wake Lock viene rilasciato automaticamente dal browser quando la tab passa in
  // background (es. l'utente cambia app sul telefono, o minimizza) — se poi torna a
  // guardare la pagina mentre la radio sta ancora suonando, va richiesto di nuovo.
  useEffect(() => {
    if (!("wakeLock" in navigator)) return;
    const onVisibilityChange = async () => {
      if (document.visibilityState === "visible" && isPlaying && !wakeLockRef.current) {
        try { wakeLockRef.current = await navigator.wakeLock.request("screen"); }
        catch (e) { console.warn("Wake Lock non ottenuto:", e.message); }
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [isPlaying]);

  // Gestionale: recupero della riproduzione al ritorno in primo piano. I browser
  // sospendono/rallentano l'iframe YouTube (e talvolta l'<audio>) quando la scheda va in
  // background: al rientro il player può essere rimasto in pausa anche se l'intento è
  // "in riproduzione". Qui, appena la scheda torna visibile, se stiamo trasmettendo
  // riavviamo SEMPRE il player realmente attivo in questo momento (YouTube o file custom),
  // così cambiare scheda/app non lascia mai la radio ferma. È la contropartita del fatto
  // che ora ignoriamo i PAUSED "fantasma" mentre siamo in background.
  useEffect(() => {
    if (!isGestionale) return;
    const onVis = () => {
      if (document.visibilityState !== "visible" || !isPlayingRef.current) return;
      const c = currentRef.current;
      if (c && !c.isCustom) {
        armSuppressPause();
        ytPlayerRef.current?.playVideo?.();
      } else if (audioRef.current && audioRef.current.paused && !audioRef.current.ended) {
        // !ended: un mp3 arrivato alla FINE non va ri-avviato (play() su "ended"
        // ricomincia da capo — altra via del "la ripete un paio di volte" su Giulia).
        safePlayAudio(audioRef.current).catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [isGestionale]);

  // Gestionale: "cane da guardia" della riproduzione, attivo ANCHE a scheda in background.
  // Il recupero qui sopra scatta solo quando si torna sulla scheda: se nel frattempo il
  // browser (o l'iframe YouTube) aveva messo in pausa il player, la radio restava muta
  // finché il gestore non tornava sulla pagina — la "pausa da sola" mentre si lavora su
  // altro. Ogni 5 secondi controlliamo: se la trasmissione DOVREBBE suonare ma il player
  // risulta fermo in pausa per due controlli di fila (almeno 5 secondi, quindi non un
  // semplice buffering, che è uno stato diverso), lo facciamo ripartire.
  useEffect(() => {
    if (!isGestionale) return;
    let stalledChecks = 0;
    const check = () => {
      const c = currentRef.current;
      if (!isPlayingRef.current || !c) { stalledChecks = 0; return; }
      let stalled = false;
      if (c.isCustom) {
        const a = audioRef.current;
        // !ended: a fine mp3 ci pensa onEnded (goNext); ri-avviarlo lo farebbe ripartire da capo.
        stalled = !!a && !!a.src && a.paused && !a.ended;
      } else {
        const state = ytPlayerRef.current?.getPlayerState?.();
        const S = window.YT?.PlayerState;
        stalled = !!S && (state === S.PAUSED || state === S.CUED);
      }
      stalledChecks = stalled ? stalledChecks + 1 : 0;
      if (stalledChecks < 2) return;
      stalledChecks = 0;
      if (c.isCustom) {
        safePlayAudio(audioRef.current).catch(() => {});
      } else {
        armSuppressPause();
        ytPlayerRef.current?.playVideo?.();
      }
    };
    // Il "battito" dei 5 secondi arriva da startTicker (Web Worker): un player fermo
    // rende la scheda silenziosa, ed è proprio il caso in cui Chrome rallenta i timer.
    return startTicker(check, 5000);
  }, [isGestionale]);

  // Media Session: espone titolo/artista e i controlli play-pausa al sistema operativo
  // (notifica, lock screen, cuffie bluetooth, tasti multimediali). Oltre a essere comodo,
  // aiuta anche a far percepire al browser/OS la pagina come "riproduzione multimediale
  // attiva", che su alcuni browser riduce il rischio che una tab in background venga
  // messa in pausa/limitata per risparmio risorse.
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const track = isGestionale ? current : radioTrack;
    if (track) {
      navigator.mediaSession.metadata = new window.MediaMetadata({
        title: track.title || "Radio Pucciotto",
        artist: track.artist || "",
        album: "Radio Pucciotto",
        artwork: [{ src: "/logo.png", sizes: "512x512", type: "image/png" }],
      });
    }
    navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
  }, [isPlaying, current?.id, radioTrack, isGestionale]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.setActionHandler("play", () => { unlockAdAudio(); userPausedRef.current = false; setIsPlaying(true); });
    // Gestionale: il comando "pausa" del SISTEMA (tasti multimediali, cuffie bluetooth
    // tolte/scollegate, una chiamata Teams/Zoom/WhatsApp che si prende l'audio, un'altra
    // app che parte) va IGNORATO. Prima metteva in pausa la trasmissione intera — e con
    // essa la radio per tutti gli ascoltatori — senza che nessuno avesse toccato la
    // pagina: era una delle cause della "pausa da sola" a scheda in background. Il
    // gestionale si mette in pausa solo dal suo pulsante. L'handler vuoto (non null)
    // serve a impedire anche l'azione predefinita del browser (fermare i media).
    navigator.mediaSession.setActionHandler("pause", isGestionale ? () => {} : () => { userPausedRef.current = true; setIsPlaying(false); });
    return () => {
      navigator.mediaSession.setActionHandler("play", null);
      navigator.mediaSession.setActionHandler("pause", null);
    };
  }, []);

  // Barra di avanzamento su lock screen / notifica (dove il browser la supporta): dà
  // l'esperienza di un lettore musicale vero. In try/catch perché valori non validi
  // (durata 0/NaN, posizione oltre la durata) fanno lanciare eccezioni all'API.
  useEffect(() => {
    if (!("mediaSession" in navigator) || !("setPositionState" in navigator.mediaSession)) return;
    try {
      if (duration && isFinite(duration) && duration > 0) {
        navigator.mediaSession.setPositionState({
          duration,
          position: Math.max(0, Math.min(progress || 0, duration)),
          playbackRate: 1,
        });
      } else {
        navigator.mediaSession.setPositionState();
      }
    } catch (_) { /* valori non ancora validi, ignora */ }
  }, [progress, duration]);

  // Gestionale: playSpotInBackground/playSpotSolo impostano il volume dello spot UNA
  // VOLTA SOLA, nel momento in cui parte. Senza questo effetto, se il gestore sposta lo
  // slider (volume generale o volume spot) MENTRE uno spot sta già suonando, quello
  // spot resta al volume vecchio finché non finisce — dava l'impressione che il volume
  // "non funzionasse" perché il cambiamento sembrava non avere alcun effetto immediato.
  useEffect(() => {
    if (!isGestionale || !adAudioRef.current) return;
    const spotAudio = adAudioRef.current;
    if (!spotAudio.paused && spotAudio.src) {
      spotAudio.volume = Math.min(1, volume * adVolume);
    }
  }, [volume, adVolume, isGestionale]);

  // Quando cambia isPlaying (senza cambiare brano) — SOLO gestionale: qui `current` è la
  // playlist locale che l'admin sta effettivamente pilotando per la trasmissione.
  useEffect(() => {
    if (!isGestionale) return;
    const isYT = current && !current.isCustom;
    if (isYT) {
      if (!ytReady || !ytPlayerRef.current) return;
      if (isPlaying) {
        shouldPlayRef.current = true;
        ytPlayerRef.current.playVideo();
      } else {
        shouldPlayRef.current = false;
        ytPlayerRef.current.pauseVideo();
        setStatus("In pausa");
      }
      return;
    }
    if (!audioRef.current) return;
    if (isPlaying) {
      shouldPlayRef.current = true;
      // NON ri-avviare un mp3 già FINITO: play() su un elemento "ended" ricomincia da
      // capo — era una delle vie del "la ripete un paio di volte" su Giulia. Al brano
      // successivo pensa goNext/il cambio traccia (che sostituisce la src e azzera ended).
      if (audioRef.current.ended) return;
      const p = safePlayAudio(audioRef.current);
      if (p && p.then) {
        p.then(() => setStatus("In riproduzione"))
         .catch(() => {}); // onCanPlay gestirà il play se il file non è ancora pronto
      }
    } else {
      shouldPlayRef.current = false;
      safePauseAudio(audioRef.current);
      setStatus("In pausa");
    }
  }, [isPlaying, ytReady, isGestionale]);

  // Quando cambia il brano: carica il video su YouTube (o il file <audio> per "Le mie canzoni").
  // SOLO gestionale — in vista pubblica il caricamento è governato esclusivamente
  // dall'effetto legato a radioTrack (Firebase), per non spezzare la sincronizzazione.
  useEffect(() => {
    if (!isGestionale || !current) return;
    setStatus("Caricamento...");
    setProgress(0);
    setDuration(0);

    if (current.isCustom) {
      // Brani caricati dall'utente: restano riprodotti via tag <audio>
      ytPlayerRef.current?.pauseVideo?.();
      if (audioRef.current) {
        // Qui usiamo un pause() diretto e sincrono (non safePauseAudio): stiamo per
        // sostituire subito la sorgente, quindi vogliamo fermare SUBITO il brano
        // precedente. Usare la versione "differita" qui era sbagliato: il pause
        // poteva arrivare DOPO aver già caricato il nuovo brano, silenziandolo per
        // errore invece di fermare quello vecchio.
        audioRef.current.pause();
        audioRef.current.src = current.url;
        audioRef.current.load();
      }
    } else if (ytReady && current.videoId) {
      // IMPORTANTE: se si arriva qui da un brano locale (custom), il tag <audio> continua
      // a suonare in sottofondo finché non lo fermiamo esplicitamente — è la causa del
      // "mix" tra il brano locale e quello nuovo di YouTube sentito solo nel gestionale
      // (la vista pubblica lo fermava già correttamente).
      if (audioRef.current) audioRef.current.pause();
      if (isPlaying || shouldPlayRef.current) {
        armSuppressPause();
        ytPlayerRef.current.loadVideoById(current.videoId);
      } else {
        ytPlayerRef.current.cueVideoById(current.videoId);
      }
    }
  }, [current?.id, ytReady, isGestionale]);

  // NOTA: il play/pausa della vista pubblica è gestito in un UNICO effetto più sotto,
  // insieme al caricamento del brano trasmesso (radioTrack), per evitare che due effetti
  // separati si contendano il controllo dello stesso <audio>/player YouTube (causa dei
  // conflitti/sovrapposizioni che a volte si vedevano all'avvio).

  // Polling per aggiornare avanzamento/durata del player YouTube.
  // Gestionale: segue `current`. Vista pubblica: segue radioTrack (il brano trasmesso).
  useEffect(() => {
    const isCustomNow = isGestionale ? current?.isCustom : radioTrack?.isCustom;
    if (isCustomNow) return; // per i brani custom il progresso arriva da onTimeUpdate dell'<audio>
    const id = setInterval(() => {
      const p = ytPlayerRef.current;
      if (p && p.getCurrentTime) {
        setProgress(p.getCurrentTime() || 0);
        setDuration(p.getDuration() || 0);
      }
    }, 500);
    return () => clearInterval(id);
  }, [isGestionale, current?.isCustom, radioTrack?.isCustom]);

  const removeCustomTrack = (id) => {
    setCustomTracks((prev) => {
      const track = prev.find((t) => t.id === id);
      if (track && track.isBlob) URL.revokeObjectURL(track.url);
      return prev.filter((t) => t.id !== id);
    });
    setCurrentIndex(0);
    setIsPlaying(false);
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setProgress(audioRef.current.currentTime);
      setDuration(audioRef.current.duration || 0);
    }
  };

  // Pubblica il brano corrente su Firebase (solo dal gestionale). elapsedSeconds
  // permette di ripubblicare lo STESSO brano ma con un punto di partenza diverso
  // (es. dopo un seek manuale sulla barra di avanzamento): sottraendolo da "ora"
  // otteniamo uno startedAt tale per cui gli ascoltatori ricalcolano subito la
  // posizione corretta, invece di restare fermi al punto vecchio.
  const publishNowPlaying = (track, elapsedSeconds = 0) => {
    if (!track || !isGestionale) return;
    set(ref(db, "nowPlaying"), {
      videoId: track.videoId || null,
      url: track.url || null,
      title: track.title,
      artist: track.artist,
      category: track.category,
      color: track.color,
      isCustom: track.isCustom || false,
      startedAt: Date.now() - elapsedSeconds * 1000,
    }).catch((e) => console.warn("Firebase write error:", e));
  };

  // Pubblica su Firebase quale spot sta partendo (solo dal gestionale), così tutti gli
  // ascoltatori lo sentono nello stesso istante. Passare null segnala la fine dello spot,
  // così la vista pubblica sa quando riprendere la musica normale.
  const publishAdPlaying = (spotUrl) => {
    if (!isGestionale) return;
    set(ref(db, "adPlaying"), spotUrl ? { url: spotUrl, startedAt: Date.now() } : null)
      .catch((e) => console.warn("Firebase write error (adPlaying):", e));
  };

  // NOTA: NON pubblichiamo qui su Firebase (niente publishNowPlaying manuale).
  // C'è già un useEffect dedicato più sotto (quello con dipendenze
  // [current?.id, isPlaying, isGestionale]) che pubblica automaticamente ogni
  // volta che il brano cambia. Chiamare publishNowPlaying anche qui creava una
  // DOPPIA scrittura su Firebase ad ogni skip: la vista pubblica riceveva due
  // aggiornamenti quasi simultanei e il secondo interrompeva il caricamento del
  // video appena avviato dal primo, mandando in stallo il player (da qui la
  // necessità di premere Play manualmente).
  const goNext = () => {
    // Nessuno spot legato al cambio canzone: l'unico meccanismo di spot è quello "ogni N
    // minuti" (timer sul tempo totale di trasmissione). goNext ora si limita a passare al
    // brano successivo.
    if (!filtered.length) return; // lista vuota: evita currentIndex = NaN (% 0)
    setCurrentIndex((i) => (i + 1) % filtered.length);
    setProgress(0);
    setIsPlaying(true);
  };
  useEffect(() => { goNextRef.current = goNext; });

  const goPrev = () => {
    if (!filtered.length) return; // lista vuota: evita currentIndex = NaN (% 0)
    setCurrentIndex((i) => (i - 1 + filtered.length) % filtered.length);
    setProgress(0);
    setIsPlaying(true);
  };

  // Rotazione fissa: 1 → 2 → 3 → 1 … Prima lo spot era scelto a caso (evitando solo di
  // ripetere l'ultimo), quindi poteva uscire 1, 2, 1, 2… e uno spot restare fuori a lungo.
  // Viene chiamata solo quando lo spot parte davvero, quindi uno spot scartato non fa
  // avanzare la rotazione.
  const pickNextSpot = () => {
    const idx = nextSpotIndexRef.current % AD_SPOTS.length;
    nextSpotIndexRef.current = (idx + 1) % AD_SPOTS.length;
    try { localStorage.setItem("rp_next_spot", String(nextSpotIndexRef.current)); } catch (_) { /* resta la rotazione in memoria */ }
    return AD_SPOTS[idx];
  };

  // Sblocca l'<audio> degli spot alla prima interazione utente diretta (click su Play),
  // sia in vista pubblica sia nel gestionale: senza questo, gli spot innescati in modo
  // "automatico" (il timer dei 2 minuti, o un evento Firebase) vengono bloccati in
  // silenzio dal browser perché non sono la diretta conseguenza di un gesto dell'utente.
  // ─── Web Audio per gli spot (ascoltatore) ────────────────────────────────
  const getAudioCtx = () => {
    if (!audioCtxRef.current) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) { try { audioCtxRef.current = new AC(); } catch (_) { audioCtxRef.current = null; } }
    }
    return audioCtxRef.current;
  };
  // Scarica e DECODIFICA uno spot in un AudioBuffer (cachato). Usa la forma con callback di
  // decodeAudioData per compatibilità anche con Safari più vecchi.
  const loadSpotBuffer = (url) => {
    const ctx = getAudioCtx();
    if (!ctx) return Promise.resolve(null);
    if (spotBuffersRef.current[url]) return Promise.resolve(spotBuffersRef.current[url]);
    return fetch(url)
      .then((r) => r.arrayBuffer())
      .then((ab) => new Promise((res) => {
        ctx.decodeAudioData(ab, (buf) => { spotBuffersRef.current[url] = buf; res(buf); }, () => res(null));
      }))
      .catch(() => null);
  };
  const stopSpotWA = () => {
    if (spotSourceRef.current) {
      try { spotSourceRef.current.onended = null; spotSourceRef.current.stop(); } catch (_) {}
      spotSourceRef.current = null;
    }
    spotGainRef.current = null;
  };
  // Avvia uno spot via Web Audio. Ritorna true se è partito, false se non è possibile
  // (così l'effetto ricade sul tag <audio>). onended viene chiamato a fine spot.
  const playSpotWA = (url, vol, onended) => {
    const ctx = getAudioCtx();
    if (!ctx) return Promise.resolve(false);
    const kick = ctx.state === "suspended" ? ctx.resume().catch(() => {}) : Promise.resolve();
    return kick.then(() => {
      // Se il contesto NON è davvero attivo (resume fallito: nessun gesto utente ancora,
      // o browser che lo tiene sospeso), NON fingere di suonare: prima si proseguiva lo
      // stesso e lo spot "suonava" in silenzio, sembrando bloccato. Meglio dichiarare il
      // fallimento e lasciare che il fallback <audio> ci provi.
      if (ctx.state !== "running") return null;
      return loadSpotBuffer(url);
    }).then((buf) => {
      if (!buf) return false;
      stopSpotWA();
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const gain = ctx.createGain();
      gain.gain.value = Math.max(0, Math.min(1, vol));
      src.connect(gain).connect(ctx.destination);
      src.onended = () => { if (spotSourceRef.current === src) spotSourceRef.current = null; onended && onended(); };
      try { src.start(0); } catch (_) { return false; }
      spotSourceRef.current = src;
      spotGainRef.current = gain;
      return true;
    }).catch(() => false);
  };

  // "Motore audio": porta il contesto Web Audio in stato attivo e avvia (una volta sola)
  // il loop di silenzio perpetuo che impedisce al browser di sospenderlo nelle schede in
  // background. Chiamato dal click su Play, dal PRIMO gesto qualsiasi sulla pagina (vedi
  // effetto più sotto) e ad ogni ritorno della scheda in primo piano: prima era legato
  // SOLO al click su Play, quindi se la radio partiva da sola (autoplay) senza che
  // l'utente cliccasse nulla, il motore restava bloccato e lo spot in background falliva.
  const kickAudioEngine = () => {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const startSilentLoop = () => {
      if (silentLoopRef.current || ctx.state !== "running") return;
      try {
        const buf = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate / 2)), ctx.sampleRate);
        const src = ctx.createBufferSource();
        const g = ctx.createGain();
        if (isGestionale) {
          // GESTIONALE: un buffer di zeri (come prima) è silenzio vero, e il browser lo
          // misura come tale: con la scheda in background e senza altro audio (muto
          // generale, volume a zero, player fermo) la considerava "silenziosa" e dopo
          // qualche minuto la CONGELAVA per risparmiare energia. Si fermava tutto,
          // compreso il collegamento a Firebase (la radio risultava OFFLINE), e ripartiva
          // da dove era rimasta solo tornando sulla scheda. Ora suona un tono a 20 Hz a
          // -60 dB: non si sente (orecchio e altoparlanti non lo riproducono a quel
          // livello), ma supera la soglia sotto cui il browser considera la scheda muta,
          // quindi non viene più congelata. 10 cicli esatti in mezzo secondo: il loop è
          // continuo, senza "click".
          const data = buf.getChannelData(0);
          for (let i = 0; i < data.length; i++) data[i] = Math.sin((2 * Math.PI * 20 * i) / ctx.sampleRate);
          g.gain.value = 0.001;
        } else {
          g.gain.value = 0.0001; // buffer di zeri: basta a tenere vivo il contesto per gli spot
        }
        src.buffer = buf;
        src.loop = true;
        src.connect(g).connect(ctx.destination);
        src.start(0);
        silentLoopRef.current = src;
      } catch (_) { /* non supportato: pazienza, resta il comportamento di prima */ }
    };
    if (ctx.state === "suspended") ctx.resume().then(startSilentLoop).catch(() => {});
    else startSilentLoop();
    if (!isGestionale) AD_SPOTS.forEach((u) => loadSpotBuffer(u));
  };

  const unlockAdAudio = () => {
    // Web Audio: sblocca/riprende il contesto e precarica gli spot dell'ascoltatore,
    // così poi suonano subito e restano vivi anche a scheda in background.
    kickAudioEngine();
    if (adAudioUnlockedRef.current || !adAudioRef.current) return;
    adAudioUnlockedRef.current = true;
    const a = adAudioRef.current;
    // Sta già suonando (uno spot partito da solo): è già "sbloccato". Cambiarne la
    // sorgente qui sotto lo interromperebbe a metà: era ciò che succedeva se il primo
    // tocco sulla pagina capitava proprio durante uno spot.
    if (!a.paused) return;
    const wasMuted = a.muted;
    // IMPORTANTE: il tag <audio> degli spot potrebbe non avere ancora una src reale.
    // Chiamare play() senza sorgente fallisce subito (nessun contenuto da riprodurre) e
    // lo "sblocco" non avviene davvero. Impostando qui una src reale (uno spot vero),
    // il play muto va a buon fine e l'elemento resta sbloccato per le riproduzioni future.
    a.src = AD_SPOTS[0];
    a.muted = true;
    a.play().then(() => { a.pause(); a.currentTime = 0; a.muted = wasMuted; })
      .catch(() => { a.muted = wasMuted; });
  };

  // Sblocco audio al PRIMO gesto qualsiasi sulla pagina (tocco, click ovunque, tasto):
  // i browser sbloccano l'audio solo dopo un'interazione, ma non è detto che l'utente
  // passi dal pulsante Play (la radio può partire da sola). Qualunque primo gesto ora
  // sblocca sia il contesto Web Audio (con loop di silenzio) sia il tag <audio> degli
  // spot. I listener si auto-rimuovono appena lo sblocco è riuscito davvero.
  // In più, ad ogni ritorno della scheda in primo piano si riprova a riattivare il
  // motore audio (dopo la prima interazione il browser lo consente anche senza gesto).
  useEffect(() => {
    const events = ["pointerdown", "touchstart", "keydown"];
    const onGesture = () => {
      unlockAdAudio();
      const ctx = audioCtxRef.current;
      if (ctx && ctx.state === "running" && silentLoopRef.current) {
        events.forEach((n) => document.removeEventListener(n, onGesture));
      }
    };
    const onVis = () => {
      if (document.visibilityState === "visible") kickAudioEngine();
    };
    events.forEach((n) => document.addEventListener(n, onGesture, { passive: true }));
    document.addEventListener("visibilitychange", onVis);
    return () => {
      events.forEach((n) => document.removeEventListener(n, onGesture));
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  const playSpotInBackground = () => {
    // Niente controllo su isMutedRef: il muto generale del gestionale silenzia solo
    // l'audio locale (audio.muted, vedi effetto dedicato), non deve impedire allo
    // spot di partire e di essere pubblicato su Firebase per la radio pubblica.
    if (!adAudioRef.current) return;
    const spotAudio = adAudioRef.current;
    // Se uno spot è già in corso (es. quello "ogni 3 canzoni" partito da pochissimo),
    // non sovrascriverlo: cambiare la sorgente a metà lo taglia bruscamente e lo
    // ascoltatore sente un salto/troncamento invece dello spot intero. Il prossimo
    // giro dell'intervallo dei 2 minuti riproverà.
    if (!spotAudio.paused && spotAudio.src) return;
    // Cooldown condiviso: non far partire un altro spot se ne è appena finito uno
    // (avviato dall'altro meccanismo), anche se ora sono passati i suoi N minuti.
    if ((Date.now() - lastAdEndedAtRef.current) / 1000 < MIN_GAP_BETWEEN_ADS_S) return;
    const spotUrl = pickNextSpot();
    // Abbassiamo la musica (ducking) tramite applyMusicVolume: agisce su ENTRAMBI i
    // player (YouTube + <audio>), così se il brano cambia tipo durante lo spot nessuno
    // dei due resta abbassato. Il flag isDuckingRef fa sì che anche spostando lo slider
    // durante lo spot la musica resti abbassata.
    isDuckingRef.current = true;
    applyMusicVolume();
    spotAudio.src = spotUrl;
    spotAudio.load();
    spotAudio.currentTime = 0;
    // Volume dello spot proporzionale al volume generale (niente più +0.2 fisso):
    // a volume generale basso/zero, lo spot deve essere basso/zero anch'esso.
    spotAudio.volume = Math.min(1, volume * adVolume);
    publishAdPlaying(spotUrl);
    // Qualunque spot parta, l'orologio del timer a minuti riparte da qui.
    lastScheduledAdAtRef.current = Date.now();
    const restore = () => {
      lastAdEndedAtRef.current = Date.now();
      isDuckingRef.current = false;
      applyMusicVolume(); // torna al volume ATTUALE (non a quello dell'avvio dello spot)
      publishAdPlaying(null);
    };
    armSpotRestore(spotAudio, restore);
    // Aspetta che il file sia caricato PRIMA di chiamare play(): chiamarlo subito dopo
    // aver impostato la src, con la scheda del gestionale in background, faceva scattare
    // il blocco "video-only background media... paused to save power" (il browser non sa
    // ancora che il file ha una traccia audio). A file pronto, di solito suona anche in
    // background.
    let started = false;
    const startLocal = () => {
      if (started) return;
      started = true;
      const p = spotAudio.play();
      // IMPORTANTE: se il play LOCALE viene comunque rifiutato (scheda in background),
      // NON dobbiamo spegnere lo spot su Firebase: gli ascoltatori lo stanno sentendo!
      // Prima qui veniva chiamato finish() -> restore() -> publishAdPlaying(null), che
      // TAGLIAVA lo spot a tutta la radio appena il monitor locale del gestionale era
      // bloccato. Ora il fallimento locale viene solo registrato: al ripristino (e alla
      // pubblicazione del null) ci pensano i timer di armSpotRestore, calibrati sulla
      // durata reale dello spot, così gli ascoltatori lo sentono per intero.
      if (p && p.catch) p.catch((e) => console.warn("Spot non udibile in locale (la radio lo trasmette comunque):", e.message));
    };
    if (spotAudio.readyState >= 4) startLocal();
    else {
      spotAudio.addEventListener("canplaythrough", startLocal, { once: true });
      setTimeout(startLocal, 5000);
    }
  };

  // Gestionale: pubblica su Firebase ogni volta che current cambia, o quando si preme Play
  // sul brano già selezionato (senza isPlaying nelle dipendenze, il click su Play da solo
  // non ripubblicava nulla se il brano non cambiava — questo è il motivo per cui la radio
  // pubblica restava su "In attesa della diretta...").
  // lastPublishedTrackIdRef distingue i due casi: un VERO cambio di brano deve ripartire
  // da 0, ma una semplice ripresa dopo pausa sullo STESSO brano deve mantenere il punto in
  // cui era rimasto — altrimenti ogni pausa/play del gestore faceva ripartire la canzone
  // da capo anche per gli ascoltatori, che magari erano avanti di due minuti.
  const lastPublishedTrackIdRef = useRef(null);
  useEffect(() => {
    if (!isGestionale) return;
    if (!current || !isPlaying) {
      // Il gestionale è connesso ma non sta trasmettendo (pausa, nessun brano
      // selezionato): senza questo, "nowPlaying" restava fermo all'ultimo brano
      // pubblicato e la vista pubblica risultava "LIVE" anche a trasmissione ferma.
      // Solo se QUESTA scheda ha già trasmesso qualcosa: appena aperto (o ricaricato),
      // il gestionale non è ancora in play, e prima questa scrittura spegneva la diretta
      // per tutti — anche quella che stava andando da un'altra scheda del gestionale.
      if (lastPublishedTrackIdRef.current !== null) {
        set(ref(db, "nowPlaying"), null).catch((e) => console.warn("Firebase write error:", e));
      }
      return;
    }
    const isNewTrack = lastPublishedTrackIdRef.current !== current.id;
    lastPublishedTrackIdRef.current = current.id;
    publishNowPlaying(current, isNewTrack ? 0 : progress);
  }, [current?.id, isPlaying, isGestionale]);

  // Battito di sincronizzazione ("heartbeat"): ogni 15s il gestionale ripubblica il brano
  // corrente con la sua POSIZIONE REALE di riproduzione. Serve perché il gestionale, tra
  // caricamenti, buffering e pubblicità di YouTube, resta indietro rispetto all'orologio,
  // mentre gli ascoltatori (che calcolano la posizione da startedAt) seguono l'orologio:
  // senza correzione la radio finiva sempre più AVANTI del gestionale. Gli ascoltatori
  // applicano il battito solo se lo scarto supera i 5 secondi (vedi soglie più sotto),
  // quindi niente micro-salti continui: solo correzioni vere quando serve.
  useEffect(() => {
    if (!isGestionale) return;
    // startTicker: il battito deve continuare regolare anche col gestionale in background
    // e silenzioso (muto generale), quando Chrome rallenta i timer della pagina.
    return startTicker(() => {
      if (!isPlayingRef.current) return;
      const c = currentRef.current;
      if (!c) return;
      const t = c.isCustom
        ? (audioRef.current?.currentTime || 0)
        : (ytPlayerRef.current?.getCurrentTime?.() || 0);
      // Niente battito nei primissimi secondi: durante il caricamento la posizione
      // riportata dal player è instabile e pubblicherebbe valori sballati.
      if (t > 3) publishNowPlaying(c, t);
    }, 15000);
  }, [isGestionale]);

  // Vista radio pubblica: ascolta Firebase in tempo reale, è l'UNICA fonte del brano in onda.
  // Aggiorna solo lo stato: il caricamento nel player YT / <audio> è gestito da un effetto
  // dedicato più sotto, che reagisce a radioTrack e sa gestire sia YouTube che brani custom.
  useEffect(() => {
    if (isGestionale) return;
    const nowPlayingRef = ref(db, "nowPlaying");
    const unsub = onValue(nowPlayingRef, (snapshot) => {
      setRadioTrack(snapshot.val());
    });
    return () => unsub();
  }, [isGestionale]);

  // Il gestionale pubblica il volume degli spot scelto sullo slider, così il
  // bilanciamento impostato "a orecchio" vale davvero anche per chi ascolta,
  // non solo per i test locali sul dispositivo del gestore.
  // IMPORTANTE: prima l'errore veniva solo loggato in console (console.warn), quindi
  // se le regole del Realtime Database non permettevano la scrittura su "settings/adVolume"
  // (es. regole che autorizzano esplicitamente solo "nowPlaying" e "adPlaying" ma non
  // "settings"), il gestore spostava lo slider, l'interfaccia sembrava reagire
  // normalmente, ma il valore non arrivava MAI a Firebase — e quindi il cliente non
  // sentiva alcun cambiamento nel bilanciamento spot/musica. Ora l'errore viene mostrato
  // anche nello stato a video, così il problema è visibile subito invece di restare
  // silenzioso.
  // Il valore si salva SOLO quando il gestore sposta lo slider (vedi onChange più sotto).
  // Prima veniva scritto anche all'apertura del gestionale, col valore di default (70%):
  // ogni volta che si apriva/ricaricava il gestionale, il volume spot scelto veniva perso
  // per tutti gli ascoltatori. Ora all'apertura il gestionale LEGGE il valore salvato.
  const adVolumeTouchedRef = useRef(false);
  const saveAdVolume = (v) => {
    adVolumeTouchedRef.current = true;
    set(ref(db, "settings/adVolume"), v).catch((e) => {
      console.warn("Firebase write error:", e);
      setStatus("Errore salvataggio volume spot — controlla le regole del Realtime Database (" + e.message + ")");
    });
  };
  useEffect(() => {
    if (!isGestionale) return;
    get(ref(db, "settings/adVolume"))
      .then((snapshot) => {
        const v = snapshot.val();
        // Se nel frattempo il gestore ha già spostato lo slider, vale la sua scelta.
        if (typeof v === "number" && !adVolumeTouchedRef.current) setAdVolume(v);
      })
      .catch((e) => console.warn("Lettura volume spot non riuscita:", e));
  }, [isGestionale]);

  // Vista pubblica: riceve il volume spot impostato dal gestionale e lo applica,
  // al posto del valore di default locale.
  useEffect(() => {
    if (isGestionale) return;
    const adVolumeRef = ref(db, "settings/adVolume");
    const unsub = onValue(adVolumeRef, (snapshot) => {
      const v = snapshot.val();
      if (typeof v === "number") setAdVolume(v);
    });
    return () => unsub();
  }, [isGestionale]);

  // Vista radio pubblica: ascolta lo spot in onda pubblicato dal gestionale via Firebase.
  // hasSeenFirstAdSnapshotRef distingue due casi ben diversi:
  // - il PRIMO snapshot ricevuto dopo il mount può essere uno spot già in corso (la
  //   pagina si è aperta/ricollegata a metà spot): qui ha senso "recuperare" il punto
  //   giusto con un seek in avanti.
  // - tutti gli snapshot SUCCESSIVI, mentre si è già connessi, sono spot che partono
  //   ORA in diretta: qui il seek NON va fatto, perché l'elapsed calcolato include
  //   solo latenza di rete/caricamento, non riproduzione reale — applicarlo tagliava
  //   sistematicamente l'inizio dello spot.
  const hasSeenFirstAdSnapshotRef = useRef(false);
  // Ricorda QUALE spot (url + istante di partenza) è già stato avviato: senza questo,
  // ogni volta che l'effetto si riattivava per un motivo estraneo (es. il gestionale
  // tocca lo slider "Volume spot" durante lo spot stesso) lo spot ripartiva da capo
  // per tutti gli ascoltatori, invece di continuare da dove era arrivato.
  const lastStartedAdKeyRef = useRef(null);
  // Ricorda l'ultimo spot GIÀ concluso localmente (evento "ended"): se l'effetto si
  // riattiva mentre su Firebase c'è ancora lo stesso spot (il null di fine non è ancora
  // arrivato), questo evita di rimetterlo in play e di ri-abbassare la musica.
  const finishedAdKeyRef = useRef(null);
  // Spot dell'ascoltatore in fase di avvio (caricamento/decodifica) e timer di sicurezza
  // per la "coda" dello spot dopo che il gestionale lo ha già chiuso (vedi sotto).
  const spotStartingRef = useRef(false);
  const spotTailTimerRef = useRef(null);
  const adTrackRef = useRef(null);
  adTrackRef.current = adTrack;
  useEffect(() => {
    if (isGestionale) return;
    const adPlayingRef = ref(db, "adPlaying");
    const unsub = onValue(adPlayingRef, (snapshot) => {
      const val = snapshot.val();
      const isLateJoin = !hasSeenFirstAdSnapshotRef.current;
      hasSeenFirstAdSnapshotRef.current = true;
      setAdTrack(val ? { ...val, _isLateJoin: isLateJoin } : null);
    });
    return () => unsub();
  }, [isGestionale]);

  // Vista radio pubblica: gestione dello spot, riscritta SEMPLICE e INDIPENDENTE.
  // Lo spot è un overlay a sé: parte sempre dall'inizio, suona fino alla fine, e la sua
  // riproduzione NON viene più disturbata dai cambi di canzone (per questo l'effetto non
  // dipende più da radioTrack). Rimosse le due fonti dei bug segnalati: il "recupero
  // tempo" (shouldCatchUp) che faceva partire lo spot a metà, e il riavvio automatico su
  // pausa imprevista che lo faceva fermare-e-ricominciare. Qui decidiamo solo: se c'è uno
  // spot nuovo lo avviamo da 0 e abbassiamo la musica; se non c'è (o è finito) la
  // rialziamo. Il volume della musica passa SEMPRE da applyMusicVolume, che tiene conto
  // del ducking, così un cambio canzone durante lo spot non riporta la musica a tutto volume.
  useEffect(() => {
    if (isGestionale) return;
    const spotAudio = adAudioRef.current;
    const stopEverything = () => {
      stopSpotWA();
      if (spotAudio) spotAudio.pause();
    };

    // Ascoltatore in pausa: niente spot, e la musica non va abbassata.
    if (!isPlaying) {
      // Lo spot eventualmente in corso viene interrotto: per questo ascoltatore è
      // CONCLUSO. Senza segnarlo, quando riprendeva l'ascolto mentre il gestionale lo
      // aveva ancora "in onda", la musica ripartiva abbassata a metà volume (e restava
      // così finché il gestionale non chiudeva lo spot).
      if (adTrack?.url && lastStartedAdKeyRef.current) finishedAdKeyRef.current = lastStartedAdKeyRef.current;
      spotStartingRef.current = false;
      stopEverything();
      isDuckingRef.current = false;
      applyMusicVolume();
      return;
    }

    if (adTrack?.url) {
      const adKey = adTrack.url + "|" + (adTrack.startedAt || 0);

      // Residuo orfano su Firebase (gestionale caduto a metà spot): non riprodurlo e
      // assicurati che la musica non resti abbassata.
      const age = (Date.now() - (adTrack.startedAt || 0)) / 1000;
      if (age > 90 || finishedAdKeyRef.current === adKey) {
        stopEverything();
        isDuckingRef.current = false;
        applyMusicVolume();
        return;
      }

      // Durante lo spot la musica va SEMPRE abbassata; aggiorna anche il volume dello spot
      // (Web Audio o <audio>) se nel frattempo si sposta uno slider.
      isDuckingRef.current = true;
      applyMusicVolume();
      const vol = Math.min(1, volume * adVolume);
      if (spotGainRef.current) spotGainRef.current.gain.value = vol;
      if (spotAudio && !spotAudio.paused) spotAudio.volume = vol;

      // Stesso spot già avviato: solo aggiornamento volume (sopra), niente riavvio.
      if (lastStartedAdKeyRef.current === adKey) return;
      lastStartedAdKeyRef.current = adKey;

      const onEnd = () => {
        finishedAdKeyRef.current = adKey;
        isDuckingRef.current = false;
        applyMusicVolume();
      };

      // PRIMA scelta: Web Audio (suona anche a scheda in background, niente "power saving"
      // che lo mette in pausa). Se non è possibile (browser vecchio, contesto non attivo,
      // decodifica fallita), FALLBACK al tag <audio>.
      spotStartingRef.current = true;
      playSpotWA(adTrack.url, vol, onEnd).then((ok) => {
        if (ok || !spotAudio) { spotStartingRef.current = false; return; }
        if (spotAudio.src !== new URL(adTrack.url, window.location.href).href) {
          spotAudio.src = adTrack.url;
          spotAudio.load();
        }
        spotAudio.currentTime = 0;
        spotAudio.volume = vol;
        // COME NELL'ORIGINALE: si aspetta che il file sia caricato PRIMA di chiamare
        // play(). Chiamarlo subito dopo aver impostato la src (com'era diventato) faceva
        // sì che, a scheda in background, il browser non sapesse ancora che il file ha una
        // traccia audio e lo bloccasse come "video-only background media... paused to save
        // power" — è esattamente l'errore visto in console. A file pronto, il browser sa
        // che è audio vero e lo lascia suonare anche in background.
        let started = false;
        const startOnce = () => {
          if (started) return;
          started = true;
          spotStartingRef.current = false;
          spotAudio.play().catch((e) => console.warn("Spot bloccato:", e.message));
        };
        if (spotAudio.readyState >= 4) startOnce();
        else {
          spotAudio.addEventListener("canplaythrough", startOnce, { once: true });
          // Rete di sicurezza: se canplaythrough non arriva (connessioni instabili),
          // dopo 5s si tenta comunque, come faceva il codice originale.
          setTimeout(startOnce, 5000);
        }
      });
    } else {
      // Il gestionale ha chiuso lo spot. Se QUI sta ancora suonando (o sta partendo), NON
      // lo tagliamo: l'ascoltatore lo fa sempre partire un po' dopo il gestionale (rete,
      // caricamento del file), e chi apre la radio a spot iniziato lo sente da capo.
      // Prima veniva fermato di colpo: si perdeva la coda, o quasi tutto lo spot. Lo
      // lasciamo finire: a fine spot la musica torna su da sola (onEnd / evento "ended").
      // Rete di sicurezza: se entro 20 secondi non è ancora finito, lo chiudiamo noi.
      const spotStillPlaying = spotStartingRef.current || !!spotSourceRef.current
        || (!!spotAudio && !spotAudio.paused && !spotAudio.muted && String(spotAudio.src).includes("/ads/"));
      if (spotStillPlaying) {
        if (!spotTailTimerRef.current) {
          spotTailTimerRef.current = setTimeout(() => {
            spotTailTimerRef.current = null;
            if (adTrackRef.current) return; // nel frattempo è arrivato un altro spot
            spotStartingRef.current = false;
            stopEverything();
            isDuckingRef.current = false;
            applyMusicVolume();
          }, 20000);
        }
        return;
      }
      lastStartedAdKeyRef.current = null;
      finishedAdKeyRef.current = null;
      stopEverything();
      isDuckingRef.current = false;
      applyMusicVolume();
    }
  }, [adTrack, isGestionale, volume, adVolume, isPlaying]);

  // Vista radio pubblica: quando lo spot LOCALE finisce (evento "ended"), ripristiniamo
  // subito il volume della musica, SENZA aspettare che il gestionale scriva null su
  // Firebase. Se quel null non arrivasse mai (gestionale che crolla a metà spot), prima
  // la musica restava abbassata per sempre: è il lato ascoltatore del bug del "volume
  // tagliato che resta". Ora il ducking si chiude comunque alla fine dello spot.
  useEffect(() => {
    if (isGestionale || !adAudioRef.current) return;
    const spotAudio = adAudioRef.current;
    const onSpotEnded = () => {
      // Marca questo spot come "già concluso" (vedi finishedAdKeyRef): se resta su
      // Firebase non verrà rimesso in play. Non azzeriamo lastStartedAdKeyRef qui, così
      // il guard "già finito" nell'effetto sopra riconosce ancora la chiave.
      finishedAdKeyRef.current = lastStartedAdKeyRef.current;
      isDuckingRef.current = false;
      applyMusicVolume();
    };
    spotAudio.addEventListener("ended", onSpotEnded);
    return () => spotAudio.removeEventListener("ended", onSpotEnded);
  }, [isGestionale]);

  // (Rimosso) L'effetto che faceva ripartire da solo lo spot su "pausa imprevista": era
  // una delle cause del bug "lo spot si ferma e ricomincia". Ora lo spot, se per un motivo
  // qualsiasi si ferma, resta fermo (dura pochi secondi): meglio uno spot che finisce un
  // attimo prima che uno che si riavvia in loop.

  // Vista radio pubblica: diretta ferma (il gestionale ha messo in pausa o si è
  // disconnesso). Prima l'ascoltatore continuava a sentire il brano fino alla fine mentre
  // la pagina diceva "OFFLINE", e col pulsante disattivato non poteva nemmeno fermarlo.
  // Ora, se la diretta resta ferma per 20 secondi, fermiamo anche il player locale. I 20
  // secondi di tolleranza servono per i piccoli buchi di rete del gestionale: in quel
  // caso la diretta torna da sola (vedi ripubblicazione alla riconnessione) e
  // l'ascoltatore non si accorge di nulla. Quando la diretta riparte, il brano riparte da
  // solo, a meno che l'ascoltatore non avesse messo in pausa lui.
  useEffect(() => {
    if (isGestionale || radioTrack) return;
    if (lastPublicTrackKeyRef.current === null) return; // non stava suonando nulla
    // L'ascoltatore mette in pausa durante i 20 secondi: fermiamo subito.
    if (!isPlaying) {
      ytPlayerRef.current?.pauseVideo?.();
      if (audioRef.current) safePauseAudio(audioRef.current);
    }
    const id = setTimeout(() => {
      lastPublicTrackKeyRef.current = null; // alla ripartenza verrà trattato come brano nuovo
      lastPublicStartedAtRef.current = null;
      keepAliveLoopRef.current = false;
      ytPlayerRef.current?.pauseVideo?.();
      if (audioRef.current) safePauseAudio(audioRef.current);
      setIsPlaying(false);
    }, 20000);
    return () => clearTimeout(id);
  }, [radioTrack, isPlaying, isGestionale]);

  // Vista radio pubblica: quando arriva/cambia radioTrack, carica il brano giusto
  // (YouTube o file custom) e si posiziona nel punto esatto di trasmissione, sincronizzato.
  // Gestisce ANCHE il play/pausa locale (isPlaying), tutto in un unico effetto, così non
  // ci sono più due effetti separati che si contendono il controllo dello stesso player
  // (era questa la causa dei conflitti/sovrapposizioni a volte visti all'avvio).
  useEffect(() => {
    if (isGestionale || !radioTrack) return;

    const isCustom = radioTrack.isCustom && radioTrack.url;
    const trackKey = isCustom ? radioTrack.url : radioTrack.videoId;
    const isNewTrack = lastPublicTrackKeyRef.current !== trackKey;

    if (isCustom) {
      ytPlayerRef.current?.pauseVideo?.();
      if (!audioRef.current) return;

      if (isNewTrack) {
        lastPublicTrackKeyRef.current = trackKey;
        lastPublicStartedAtRef.current = radioTrack.startedAt;
        // Pause sincrono: stiamo per sostituire subito la sorgente, quindi vogliamo
        // fermare SUBITO il brano precedente (stesso motivo del fix nel gestionale:
        // una pausa "differita" qui rischia di arrivare dopo il caricamento del nuovo
        // brano e silenziarlo per errore invece di fermare quello vecchio).
        audioRef.current.pause();
        audioRef.current.src = radioTrack.url;
        audioRef.current.load();
        const elapsed = (Date.now() - radioTrack.startedAt) / 1000;
        const startPlayback = () => {
          if (!audioRef.current) return;
          if (elapsed >= 0 && elapsed < (audioRef.current.duration || Infinity)) {
            audioRef.current.currentTime = elapsed;
          }
          // L'ascoltatore aveva messo in pausa lui: il brano nuovo resta pronto ma fermo.
          if (userPausedRef.current) return;
          // Al primo arrivo del brano tentiamo sempre l'autoplay (comportamento da "radio
          // live"); se il browser lo blocca perché manca un'interazione utente, isPlaying
          // resta false e l'utente vedrà il tasto Play pronto per partire manualmente.
          safePlayAudio(audioRef.current)
            .then(() => { setIsPlaying(true); setStatus("In riproduzione"); })
            .catch(() => {});
        };
        audioRef.current.addEventListener("loadedmetadata", startPlayback, { once: true });
      } else if (audioRef.current.ended) {
        // Il nostro mp3 è GIÀ arrivato alla fine (l'ascoltatore è un filo avanti alla
        // diretta): restiamo FERMI in silenzio ad aspettare il brano successivo da
        // Firebase. Fondamentale: play() su un <audio> "ended" RICOMINCIA DA CAPO, e
        // seekare all'indietro rientra nel brano appena finito — senza questa guardia,
        // i battiti di posizione sullo stesso brano riavviavano/facevano risentire la
        // traccia appena conclusa (il replay/blocco visto su "Giulia").
        lastPublicStartedAtRef.current = radioTrack.startedAt;
      } else {
        // Stesso brano: se lo startedAt è cambiato, il gestionale ha fatto un seek
        // manuale (avanti/indietro) o è arrivato un battito di posizione — riposizioniamo
        // l'audio sul nuovo punto invece di ignorarlo come un semplice toggle di play/pausa.
        if (lastPublicStartedAtRef.current !== radioTrack.startedAt) {
          lastPublicStartedAtRef.current = radioTrack.startedAt;
          const elapsed = (Date.now() - radioTrack.startedAt) / 1000;
          // Riposiziona solo se lo scarto è sensibile (> 5s): i battiti di posizione ogni
          // 15s e le piccole differenze di latenza non devono far "saltare" il brano
          // avanti/indietro sull'ascoltatore — solo correzioni vere.
          const drift = Math.abs(elapsed - (audioRef.current.currentTime || 0));
          if (elapsed >= 0 && elapsed < (audioRef.current.duration || Infinity) && drift > 5) {
            audioRef.current.currentTime = elapsed;
          }
        }
        if (isPlaying) safePlayAudio(audioRef.current).catch(() => {});
        else safePauseAudio(audioRef.current);
      }
    } else if (radioTrack.videoId && ytReady && ytPlayerRef.current) {
      if (audioRef.current) audioRef.current.pause();
      const elapsed = Math.max(0, (Date.now() - radioTrack.startedAt) / 1000);
      if (isNewTrack) {
        lastPublicTrackKeyRef.current = trackKey;
        keepAliveLoopRef.current = false; // arriva il brano vero: non è più il loop di attesa
        if (userPausedRef.current) {
          // L'ascoltatore aveva messo in pausa lui: prepariamo il brano nuovo SENZA farlo
          // partire (prima loadVideoById lo avviava sempre). Al suo Play, il ramo
          // "isPlaying" qui sotto lo riporta al punto giusto della diretta.
          ytPlayerRef.current.cueVideoById({ videoId: radioTrack.videoId, startSeconds: elapsed });
          return;
        }
        armSuppressPause();
        ytPlayerRef.current.loadVideoById({ videoId: radioTrack.videoId, startSeconds: elapsed });
        ytPlayerRef.current.unMute?.();
        applyMusicVolume(); // rispetta il ducking se c'è uno spot in corso durante il cambio brano
        // loadVideoById avvia sempre la riproduzione; se il browser blocca l'autoplay
        // (mancanza di interazione utente), onStateChange non passerà mai a PLAYING e
        // isPlaying resterà false: l'utente vedrà comunque il tasto Play pronto.
      } else if (keepAliveLoopRef.current) {
        // Siamo nel loop di attesa MUTO a fine brano: il nostro video è già finito, ma il
        // gestionale sta ancora finendo lo stesso brano e i suoi battiti di posizione
        // (heartbeat) arrivano ancora con questa traccia. NON dobbiamo rientrare nel
        // brano appena concluso (si risentirebbe la coda: il "replay"): restiamo in
        // attesa silenziosa finché non arriva il brano NUOVO (ramo isNewTrack sopra).
      } else if (isPlaying) {
        // Risincronizzazione sul punto reale della diretta: sia quando l'utente (ri)avvia
        // manualmente l'ascolto, sia quando arriva un battito di posizione dal gestionale.
        ytPlayerRef.current.unMute?.();
        applyMusicVolume();
        // Riposiziona solo se lo scarto è sensibile (> 5s): i battiti ogni 15s non devono
        // produrre micro-salti continui, solo correzioni vere (es. il gestionale rimasto
        // indietro per pubblicità/buffering, con la radio scappata avanti).
        const cur = ytPlayerRef.current.getCurrentTime?.() || 0;
        if (Math.abs(elapsed - cur) > 5) ytPlayerRef.current.seekTo(elapsed, true);
        ytPlayerRef.current.playVideo();
      } else {
        ytPlayerRef.current.pauseVideo();
      }
    }
  }, [radioTrack, isPlaying, ytReady, isGestionale]);


  const formatTime = (s) => {
    if (!s || isNaN(s)) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const pct = duration ? (progress / duration) * 100 : 0;

  // Nella vista pubblica il brano mostrato è SEMPRE quello trasmesso dal gestionale
  const publicTrack = radioTrack;
  const isLive = !!publicTrack;

  // ─── VISTA RADIO PUBBLICA ────────────────────────────────────────────────
  if (!isGestionale) return (
    <div className="pub-root" style={{ background: BLACK, fontFamily: "'DM Sans', sans-serif", color: WHITE, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "space-between" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Lobster&family=DM+Sans:wght@400;600;700&display=swap');
        * { box-sizing: border-box; }
        @keyframes pulse { 0%,100% { opacity: 0.4; transform: scaleY(0.4); } 50% { opacity: 1; transform: scaleY(1); } }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        /* Misure "da PC" (invariate rispetto a prima). */
        .pub-root { min-height: 100vh; min-height: 100dvh; }
        .pub-header { padding: 20px 28px; }
        .pub-logo { width: 44px; height: 44px; }
        .pub-brand { font-size: 26px; }
        .pub-main { gap: 36px; padding: 40px 28px; }
        .pub-disc { width: 180px; height: 180px; }
        .pub-disc-center { width: 60px; height: 60px; }
        .pub-cat { margin-bottom: 10px; }
        .pub-song { font-size: 22px; }
        .pub-play { width: 64px; height: 64px; }
        .pub-sponsor { padding: 10px 28px; }
        .pub-sponsor-text { font-size: 13px; }
        .pub-footer { padding: 12px 28px; }
        /* Smartphone (e finestre basse): tutta la radio deve stare in UNA schermata,
           senza scorrere. Le misure si adattano all'altezza realmente visibile (dvh =
           schermo meno le barre del browser; vh è la riserva per i browser vecchi),
           con un minimo e un massimo; i titoli lunghi vanno al massimo su 2 righe. */
        @media (max-width: 600px), (max-height: 700px) {
          .pub-header { padding: 12px 16px; }
          .pub-logo { width: 36px; height: 36px; }
          .pub-brand { font-size: 22px; }
          .pub-main { gap: clamp(8px, 2.6vh, 36px); gap: clamp(8px, 2.6dvh, 36px); padding: clamp(8px, 2.5vh, 40px) 16px; padding: clamp(8px, 2.5dvh, 40px) 16px; }
          .pub-disc { width: clamp(72px, 20vh, 180px); height: clamp(72px, 20vh, 180px); width: clamp(72px, 20dvh, 180px); height: clamp(72px, 20dvh, 180px); }
          .pub-disc-center { width: 34%; height: 34%; }
          .pub-cat { margin-bottom: 6px; }
          .pub-song { font-size: 18px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
          .pub-play { width: clamp(52px, 8.5vh, 64px); height: clamp(52px, 8.5vh, 64px); width: clamp(52px, 8.5dvh, 64px); height: clamp(52px, 8.5dvh, 64px); }
          .pub-sponsor { padding: 8px 16px; }
          .pub-sponsor-text { font-size: 12px; }
          .pub-footer { padding: 8px 16px; }
        }
      `}</style>

      {/* Header */}
      <header className="pub-header" style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div className="pub-logo" style={{ borderRadius: "50%", background: WHITE, border: `2px solid ${WHITE}`, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 }}>
            <img src="/logo.png" alt="Pucciotto" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
          </div>
          <div className="pub-brand" style={{ fontFamily: "'Lobster', cursive", color: RED }}>Radio Pucciotto</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: isLive ? "#27ae60" : "#888", boxShadow: isLive ? "0 0 6px #27ae60" : "none" }} />
          <span style={{ fontSize: "12px", color: "#888", letterSpacing: "1px" }}>{isLive ? "LIVE" : "OFFLINE"}</span>
        </div>
      </header>

      {/* Corpo centrale */}
      <div className="pub-main" style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", width: "100%", maxWidth: "480px" }}>

        {/* Player YT + equalizzatore */}
        <div className="pub-disc" style={{ position: "relative", flexShrink: 0 }}>
          <div className="pub-disc" style={{ borderRadius: "50%", background: `radial-gradient(circle, ${publicTrack?.color || RED}33, ${BLACK})`, border: `3px solid ${publicTrack?.color || RED}55`, display: "flex", alignItems: "center", justifyContent: "center", animation: isPlaying && isLive ? "spin 12s linear infinite" : "none" }}>
            <div className="pub-disc-center" style={{ borderRadius: "50%", background: BLACK, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div id="yt-player" style={{ width: 1, height: 1, overflow: "hidden", opacity: 0, position: "absolute" }} />
              {/* equalizzatore visivo */}
              <div style={{ display: "flex", gap: "4px", alignItems: "center", height: "24px" }}>
                {[0,1,2,3,4].map((i) => (
                  <div key={i} style={{ width: "3px", height: "100%", borderRadius: "2px", background: WHITE, animation: isPlaying && isLive ? `pulse ${0.5 + i * 0.12}s ease-in-out infinite` : "none", transform: isPlaying && isLive ? undefined : "scaleY(0.2)", opacity: isPlaying && isLive ? 1 : 0.3 }} />
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Info brano */}
        <div style={{ textAlign: "center" }}>
          {isLive ? (
            <>
              <div className="pub-cat" style={{ fontSize: "11px", color: publicTrack?.color || RED, letterSpacing: "2px", fontWeight: 700, textTransform: "uppercase" }}>{publicTrack?.category || "—"}</div>
              <div className="pub-song" style={{ fontWeight: 700, lineHeight: 1.2, marginBottom: "8px" }}>{publicTrack?.title}</div>
              <div style={{ fontSize: "15px", color: "#aaa" }}>{publicTrack?.artist || ""}</div>
            </>
          ) : (
            <>
              <div className="pub-cat" style={{ fontSize: "11px", color: "#888", letterSpacing: "2px", fontWeight: 700, textTransform: "uppercase" }}>Radio Pucciotto</div>
              <div className="pub-song" style={{ fontWeight: 700, lineHeight: 1.2, marginBottom: "8px" }}>In attesa della diretta...</div>
              <div style={{ fontSize: "15px", color: "#aaa" }}>La trasmissione partirà a breve</div>
            </>
          )}
        </div>

        {/* Barra avanzamento */}
        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "6px" }}>
          <div style={{ height: "3px", borderRadius: "2px", background: "rgba(255,255,255,0.1)", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${pct}%`, background: publicTrack?.color || RED, transition: "width 0.5s linear" }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "#555" }}>
            <span>{formatTime(progress)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        {/* Controlli: nella radio pubblica solo Play/Pausa dell'ascolto locale, niente skip */}
        <div style={{ display: "flex", alignItems: "center", gap: "32px" }}>
          <button
            onClick={() => {
              unlockAdAudio();
              // Ricorda se è stato l'ascoltatore a mettere in pausa (vedi userPausedRef).
              userPausedRef.current = isPlaying;
              setIsPlaying(!isPlaying);
            }}
            // Attivo anche a diretta ferma finché la musica sta ancora suonando (i 20 secondi
            // di tolleranza): prima era disattivato e l'ascoltatore non poteva fermarla.
            disabled={!isLive && !isPlaying}
            aria-label={isPlaying ? "Pausa" : "Play"}
            className="pub-play"
            style={{ borderRadius: "50%", background: isLive || isPlaying ? RED : "#444", border: "none", cursor: isLive || isPlaying ? "pointer" : "not-allowed", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: isLive || isPlaying ? `0 0 20px ${RED}55` : "none" }}>
            {isPlaying ? <Pause size={28} color={WHITE} fill={WHITE} /> : <Play size={28} color={WHITE} fill={WHITE} />}
          </button>
        </div>

        {/* Volume */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px", width: "100%" }}>
          <Volume2 size={16} color="#555" />
          <input type="range" min="0" max="1" step="0.01" value={volume} onChange={(e) => setVolume(parseFloat(e.target.value))}
            aria-label="Volume"
            style={{ flex: 1, accentColor: RED }} />
        </div>
      </div>

      {/* Banner sponsor */}
      <div className="pub-sponsor" style={{ width: "100%", background: "rgba(192,57,43,0.15)", borderTop: "1px solid rgba(192,57,43,0.2)", display: "flex", alignItems: "center", gap: "10px" }}>
        <span style={{ background: RED, color: WHITE, padding: "2px 8px", borderRadius: "5px", fontSize: "10px", fontWeight: 700, letterSpacing: "1px", flexShrink: 0 }}>SPONSOR</span>
        <span key={adLine} className="pub-sponsor-text" style={{ color: "#aaa" }}>{AD_LINES[adLine]}</span>
      </div>

      {/* Footer */}
      <footer className="pub-footer" style={{ width: "100%", textAlign: "center", fontSize: "10px", color: "#444" }}>
        Radio Pucciotto — musica © dei rispettivi titolari, via YouTube
      </footer>

      {/* NIENTE onEnded che spegne isPlaying: quando un mp3 finisce (l'ascoltatore è
          spesso un filo avanti alla diretta) restiamo "in play" in silenzio ad aspettare
          il brano successivo da Firebase — esattamente come fa il player YouTube col suo
          loop di attesa. Prima qui c'era setIsPlaying(false): la radio si fermava a fine
          traccia (es. "Giulia") e l'ascoltatore doveva ripremere Play a mano. */}
      <audio ref={audioRef} onTimeUpdate={handleTimeUpdate}
        onError={() => setStatus("Errore")} />
      <audio ref={adAudioRef} />
    </div>
  );
  // ─── FINE VISTA RADIO PUBBLICA ───────────────────────────────────────────

  return (
    <div style={{ minHeight: "100vh", background: CREAM, fontFamily: "'DM Sans', sans-serif", color: BLACK, display: "flex", flexDirection: "column" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Lobster&family=DM+Sans:wght@400;600;700&display=swap');
        * { box-sizing: border-box; }
        .pc-btn { transition: transform 0.15s ease; }
        .pc-btn:hover { transform: scale(1.08); }
        .pc-btn:active { transform: scale(0.96); }
        .cat-pill { transition: all 0.2s ease; cursor: pointer; }
        .track-row { transition: background 0.15s ease; cursor: pointer; }
        .track-row:hover { background: rgba(192,57,43,0.06) !important; }
        input[type="range"] { accent-color: ${RED}; }
        @keyframes pulse-bar { 0%,100% { transform: scaleY(0.4); } 50% { transform: scaleY(1); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
        .upload-panel { animation: fadeIn 0.2s ease; }
        .custom-badge { background: ${RED}; color: ${WHITE}; font-size: 9px; padding: 1px 5px; border-radius: 3px; font-weight: 700; letter-spacing: 0.5px; }
        @media (max-width: 480px) {
          .page-content { padding: 16px !important; }
          .player-card { padding: 16px !important; }
          .player-controls { gap: 12px !important; }
          .ad-counter, .ctrl-spacer { display: none !important; }
          .vol-control { gap: 6px !important; }
          .vol-control input[type="range"] { width: 50px !important; }
          .nav-controls { gap: 14px !important; }
        }
      `}</style>

      {/* Header */}
      <header style={{ padding: "20px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid rgba(26,26,26,0.08)", background: WHITE }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ width: 44, height: 44, borderRadius: "50%", background: WHITE, border: `2px solid ${BLACK}`, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
            <img src="/logo.png" alt="Pucciotto" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
          </div>
          <div>
            <div style={{ fontFamily: "'Lobster', cursive", fontWeight: 400, fontSize: "24px", color: BLACK }}>Radio Pucciotto</div>
            <div style={{ fontSize: "11px", color: "#888", letterSpacing: "1.5px" }}>MUSICA VIA YOUTUBE · LIVE</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#27ae60" }} />
            <span style={{ fontSize: "12px", color: "#888" }}>In onda</span>
          </div>
        </div>
      </header>

      {/* Banner pubblicitario */}
      <div style={{ background: RED, color: WHITE, padding: "10px 28px", fontWeight: 600, fontSize: "14px", display: "flex", alignItems: "center", gap: "10px" }}>
        <span style={{ background: WHITE, color: RED, padding: "2px 8px", borderRadius: "5px", fontSize: "11px", fontWeight: 700, letterSpacing: "1px" }}>SPONSOR</span>
        <span key={adLine}>{AD_LINES[adLine]}</span>
      </div>

      {(loadingTracks || loadError) && (
        <div style={{
          padding: "8px 28px", fontSize: "12px", textAlign: "center",
          background: loadingTracks ? "rgba(26,26,26,0.04)"
            : loadError?.startsWith("🔥") || loadError?.startsWith("🏆") ? "rgba(39,174,96,0.08)"
            : "rgba(192,57,43,0.08)",
          color: loadingTracks ? "#888"
            : loadError?.startsWith("🔥") || loadError?.startsWith("🏆") ? "#27ae60"
            : RED
        }}>
          {loadingTracks ? "Aggiornamento playlist..." : loadError}
        </div>
      )}

      <div className="page-content" style={{ flex: 1, padding: "28px", display: "flex", flexDirection: "column", gap: "24px", maxWidth: "900px", margin: "0 auto", width: "100%" }}>

        {/* Categorie + Shuffle */}
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
          {categories.map((cat) => (
            <div key={cat} className="cat-pill" onClick={() => setCategory(cat)} style={{
              padding: "8px 18px", borderRadius: "20px", fontSize: "13px", fontWeight: 600,
              background: category === cat ? RED : WHITE,
              color: category === cat ? WHITE : BLACK,
              border: category === cat ? "none" : "1px solid rgba(26,26,26,0.12)",
              display: "flex", alignItems: "center", gap: "6px",
            }}>
              {cat === "Le mie canzoni" && <Music size={12} />}
              {cat}
            </div>
          ))}
          <div className="cat-pill" onClick={() => setShuffleMode((v) => !v)} style={{
            padding: "8px 18px", borderRadius: "20px", fontSize: "13px", fontWeight: 600,
            background: shuffleMode ? RED : WHITE,
            color: shuffleMode ? WHITE : BLACK,
            border: shuffleMode ? "none" : "1px solid rgba(26,26,26,0.12)",
            display: "flex", alignItems: "center", gap: "6px", marginLeft: "auto",
          }}>
            <Shuffle size={13} />
            Casuale
          </div>
        </div>

        {/* Player */}
        <div className="player-card" style={{ background: WHITE, borderRadius: "20px", padding: "28px", border: "1px solid rgba(26,26,26,0.08)", boxShadow: "0 4px 20px rgba(0,0,0,.04)", display: "flex", flexDirection: "column", gap: "20px" }}>
          <div style={{ display: "flex", gap: "20px", alignItems: "center" }}>
            <div style={{ width: 84, height: 84, borderRadius: "16px", overflow: "hidden", background: BLACK, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, position: "relative" }}>
              {/* Il player YouTube viene creato UNA SOLA VOLTA e prende possesso di questo
                  div sostituendolo con un iframe reale (manipolazione diretta del DOM,
                  fuori dal controllo di React). PRIMA questo div veniva mostrato/nascosto
                  condizionalmente insieme all'icona "brano custom": React lo smontava e
                  rimontava ogni volta che si passava da un brano YouTube a uno caricato da
                  voi (o viceversa), senza sapere che nel frattempo era diventato un iframe
                  vero — questo poteva rompere silenziosamente il player (audio muto,
                  a volte un errore reale). Ora resta SEMPRE montato, nascosto solo con le
                  CSS quando non serve, così la sua identità nel DOM non cambia mai. */}
              <div id="yt-player" style={{ width: "100%", height: "100%", display: current?.isCustom ? "none" : "block" }} />
              {current?.isCustom && (
                <div style={{ position: "absolute", inset: 0, borderRadius: "16px", background: `linear-gradient(135deg, ${current?.color || RED}, ${BLACK})`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Music size={32} color={WHITE} />
                </div>
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "11px", color: "#888", letterSpacing: "1px", marginBottom: "4px", display: "flex", alignItems: "center", gap: "6px" }}>
                {current?.category?.toUpperCase()}
                {current?.isCustom && <span className="custom-badge">MIA</span>}
              </div>
              <div style={{ fontWeight: 700, fontSize: "22px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{current?.title}</div>
              <div style={{ color: "#888", fontSize: "14px" }}>{current?.artist}</div>
            </div>
          </div>

          {/* Barra progresso */}
          <div>
            <div style={{ height: "5px", borderRadius: "3px", background: "rgba(26,26,26,0.08)", overflow: "hidden", cursor: "pointer" }}
              onClick={(e) => {
                if (!duration) return;
                const rect = e.currentTarget.getBoundingClientRect();
                const t = ((e.clientX - rect.left) / rect.width) * duration;
                if (current && !current.isCustom) ytPlayerRef.current?.seekTo?.(t, true);
                else if (audioRef.current) audioRef.current.currentTime = t;
                setProgress(t);
                // Senza questo, un seek manuale restava solo locale: gli ascoltatori
                // continuavano a sentire il brano dal punto vecchio, perché Firebase
                // veniva aggiornato solo al cambio brano/play, non al semplice avanzamento.
                if (current) publishNowPlaying(current, t);
              }}>
              <div style={{ height: "100%", width: `${pct}%`, background: RED, transition: "width 0.2s linear" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "#888", marginTop: "6px" }}>
              <span>{formatTime(progress)}</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          {/* Controlli */}
          <div className="player-controls" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "20px" }}>
            <div className="vol-control" style={{ display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
              <button
                onClick={() => setIsMuted((m) => !m)}
                title={isMuted ? "Riattiva audio" : "Muto generale"}
                style={{
                  background: isMuted ? RED : "transparent",
                  border: isMuted ? "none" : "1px solid rgba(26,26,26,0.15)",
                  borderRadius: "8px",
                  width: 30, height: 30, minWidth: 30,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  cursor: "pointer", flexShrink: 0,
                }}
              >
                {isMuted ? <VolumeX size={16} color={WHITE} /> : <Volume2 size={16} color="#888" />}
              </button>
              <input type="range" min="0" max="1" step="0.05" value={volume} onChange={(e) => setVolume(parseFloat(e.target.value))} style={{ width: "70px" }} />
            </div>
            <div className="ctrl-spacer" style={{ flex: 1 }} />
            <div className="nav-controls" style={{ display: "flex", alignItems: "center", gap: "20px", flexShrink: 0 }}>
              <button className="pc-btn" onClick={goPrev} style={{ background: "transparent", border: "none", color: BLACK, cursor: "pointer", flexShrink: 0 }}>
                <SkipBack size={22} fill={BLACK} />
              </button>
              <button className="pc-btn" onClick={() => { unlockAdAudio(); setIsPlaying((p) => !p); }} style={{ width: 56, height: 56, minWidth: 56, minHeight: 56, borderRadius: "50%", background: RED, border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
                {isPlaying ? <Pause size={24} color={WHITE} fill={WHITE} /> : <Play size={24} color={WHITE} fill={WHITE} />}
              </button>
              <button className="pc-btn" onClick={goNext} style={{ background: "transparent", border: "none", color: BLACK, cursor: "pointer", flexShrink: 0 }}>
                <SkipForward size={22} fill={BLACK} />
              </button>
            </div>
            <div className="ctrl-spacer" style={{ flex: 1 }} />
            {/* Spaziatore invisibile: bilancia il controllo volume a sinistra così i
                pulsanti restano centrati (qui prima c'era il contatore "Prox. spot",
                rimosso insieme al meccanismo "ogni 3 canzoni"). */}
            <div className="ad-counter" style={{ width: "70px", flexShrink: 0 }} />
          </div>

          {/* Volume dedicato degli spot pubblicitari — indipendente dal volume generale,
              ma sempre scalato su di esso: a volume generale a zero anche gli spot
              taceranno, qui regoli solo quanto "spiccano" rispetto alla musica. */}
          <div className="vol-control" style={{ display: "flex", alignItems: "center", gap: "10px", paddingTop: "4px", borderTop: "1px dashed rgba(26,26,26,0.1)" }}>
            <Volume2 size={16} color={RED} />
            <span style={{ fontSize: "12px", color: "#888", flexShrink: 0 }}>Volume spot</span>
            <input type="range" min="0" max="1" step="0.05" value={adVolume} onChange={(e) => { const v = parseFloat(e.target.value); setAdVolume(v); saveAdVolume(v); }} style={{ flex: 1, accentColor: RED }} />
            <span style={{ fontSize: "11px", color: "#888", width: "34px", textAlign: "right", flexShrink: 0 }}>{Math.round(adVolume * 100)}%</span>
          </div>

          {/* Attivazione/disattivazione dell'unico meccanismo di spot: "ogni N minuti" */}
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <div className="cat-pill" style={{
              padding: "8px 16px", borderRadius: "20px", fontSize: "13px", fontWeight: 600,
              background: adEvery2MinEnabled ? RED : WHITE,
              color: adEvery2MinEnabled ? WHITE : BLACK,
              border: adEvery2MinEnabled ? "none" : "1px solid rgba(26,26,26,0.12)",
              display: "flex", alignItems: "center", gap: "6px",
            }}>
              <span onClick={() => setAdEvery2MinEnabled((v) => !v)} style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
                <span style={{
                  width: 16, height: 16, borderRadius: "4px", flexShrink: 0,
                  background: adEvery2MinEnabled ? WHITE : "transparent",
                  border: adEvery2MinEnabled ? "none" : "1px solid rgba(26,26,26,0.3)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {adEvery2MinEnabled && <Check size={12} color={RED} strokeWidth={3} />}
                </span>
                Spot ogni
              </span>
              <input
                type="number"
                min="1"
                max="60"
                value={adIntervalMinutes}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setAdIntervalMinutes(Math.max(1, parseInt(e.target.value, 10) || 1))}
                style={{
                  width: "40px", textAlign: "center", borderRadius: "8px", border: "none",
                  fontSize: "13px", fontWeight: 600, padding: "2px 4px",
                  color: adEvery2MinEnabled ? RED : BLACK,
                  background: WHITE,
                }}
              />
              min
            </div>
          </div>

          <audio ref={audioRef} onTimeUpdate={handleTimeUpdate} onEnded={goNext}
            onError={() => setStatus("Errore nel caricamento del brano")}
            onCanPlay={() => {
              if (shouldPlayRef.current && audioRef.current) {
                safePlayAudio(audioRef.current)
                  .then(() => setStatus("In riproduzione"))
                  .catch((e) => setStatus("Errore: " + e.message));
              } else {
                setStatus("Pronto");
              }
            }} />
          <audio ref={adAudioRef} />
          <div style={{ textAlign: "center", fontSize: "11px", color: "#888" }}>{status}</div>
        </div>

        {/* Lista brani */}
        <div>
          <div style={{ fontSize: "13px", color: "#888", letterSpacing: "1px", marginBottom: "10px", textTransform: "uppercase", fontWeight: 600 }}>
            Playlist · {category} {shuffleMode && "· 🔀 Casuale"}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            {filtered.map((t, i) => (
              <div key={t.id} className="track-row"
                onClick={() => { setCurrentIndex(i); setProgress(0); setIsPlaying(true); }}
                style={{ display: "flex", alignItems: "center", gap: "14px", padding: "10px 14px", borderRadius: "10px", background: i === currentIndex ? "rgba(192,57,43,0.08)" : "transparent" }}>
                <div style={{ width: 10, height: 10, borderRadius: "3px", background: t.color, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: "14px", color: i === currentIndex ? RED : BLACK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: "6px" }}>
                    {t.title}
                    {t.isCustom && <span className="custom-badge">MIA</span>}
                  </div>
                  <div style={{ fontSize: "12px", color: "#888" }}>{t.artist}</div>
                </div>
                <div style={{ fontSize: "11px", color: "#888", flexShrink: 0 }}>{t.isCustom ? "Le mie" : t.category}</div>
                {t.isBlob && (
                  <button onClick={(e) => { e.stopPropagation(); removeCustomTrack(t.id); }} style={{ background: "none", border: "none", cursor: "pointer", color: "#ddd", display: "flex", flexShrink: 0 }}>
                    <Trash2 size={13} />
                  </button>
                )}
                {i === currentIndex && isPlaying && <Play size={14} color={RED} fill={RED} style={{ flexShrink: 0 }} />}
              </div>
            ))}
          </div>
        </div>
      </div>

      <footer style={{ padding: "16px 28px", textAlign: "center", fontSize: "11px", color: "#aaa", borderTop: "1px solid rgba(26,26,26,0.06)", background: WHITE }}>
        Radio Pucciotto — musica © dei rispettivi titolari, via YouTube · Sponsorizzato da Pucciotto
      </footer>
    </div>
  );
}
