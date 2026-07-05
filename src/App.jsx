import React, { useState, useRef, useEffect, useMemo } from "react";
import { Play, Pause, SkipForward, SkipBack, Volume2, VolumeX, Trash2, Shuffle, Music, Check } from "lucide-react";
import { db } from "./firebase.js";
import { ref, set, onValue, onDisconnect } from "firebase/database";

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
  const [adEvery2MinEnabled, setAdEvery2MinEnabled] = useState(true);
  // Minuti configurabili tra uno spot "in sottofondo" e il successivo (prima era
  // fisso a 2 minuti, non modificabile dal gestionale).
  const [adIntervalMinutes, setAdIntervalMinutes] = useState(2);
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
  const lastSpotIndexRef = useRef(-1);
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
  const wakeLockRef = useRef(null);
  // "Ancora audio" per il gestionale: un audio nativo reale (non nell'iframe
  // YouTube) che suona in loop, quasi impercettibile, mentre si è on air. Il player
  // YouTube è un iframe di terze parti, e i browser lo rallentano/sospendono quando
  // si cambia tab — Wake Lock e Media Session non bastano a evitarlo, perché l'audio
  // "vero" nasce dentro l'iframe, non nella pagina. Un <audio> nativo che suona
  // davvero fa sì che il browser riconosca la tab come "audio attivo" e la penalizzi
  // molto meno in background, aiutando anche l'iframe YouTube accanto a restare vivo.
  const keepAliveAudioRef = useRef(null);
  useEffect(() => {
    if (!isGestionale) return;
    const a = new Audio("data:audio/wav;base64,UklGRtQEAABXQVZFZm10IBAAAAABAAEAoA8AAKAPAAABAAgAZGF0YbAEAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIA=");
    a.loop = true;
    a.volume = 0.01;
    keepAliveAudioRef.current = a;
    return () => { a.pause(); keepAliveAudioRef.current = null; };
  }, [isGestionale]);
  useEffect(() => {
    if (!isGestionale || !keepAliveAudioRef.current) return;
    if (isPlaying) keepAliveAudioRef.current.play().catch(() => {});
    else keepAliveAudioRef.current.pause();
  }, [isPlaying, isGestionale]);
  const ytPlayerRef = useRef(null);
  const [ytReady, setYtReady] = useState(false);

  // Traccia trasmessa dal gestionale via Firebase — è la fonte di verità per la vista pubblica
  const [radioTrack, setRadioTrack] = useState(null);

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
    if (isGestionale) return;
    const preloaded = AD_SPOTS.map((url) => {
      const a = new Audio();
      a.preload = "auto";
      a.src = url;
      a.load();
      return a;
    });
    return () => { preloaded.forEach((a) => { a.src = ""; }); };
  }, [isGestionale]);


  // corso, il "pulisci adPlaying alla fine dello spot" (evento "ended") non fa in
  // tempo a scattare, e quello spot resta scritto su Firebase per sempre: i prossimi
  // ascoltatori che si collegano lo trovano ancora lì e lo sentono partire "da solo".
  // onDisconnect fa pulire il nodo lato server non appena Firebase rileva che questo
  // client si è disconnesso, quale che sia il motivo (crash, chiusura tab, rete).
  useEffect(() => {
    if (!isGestionale) return;
    const cleanup = onDisconnect(ref(db, "adPlaying"));
    cleanup.set(null);
    return () => { cleanup.cancel(); };
  }, [isGestionale]);

  // Stessa protezione, ma per "nowPlaying": se il gestionale si disconnette (chiude
  // la tab, crash, perde la rete) senza aver messo in pausa, il nodo "nowPlaying"
  // altrimenti resterebbe scritto per sempre con l'ultimo brano trasmesso, e la
  // vista pubblica continuerebbe a risultare "LIVE" anche se non trasmette più nessuno.
  useEffect(() => {
    if (!isGestionale) return;
    const cleanup = onDisconnect(ref(db, "nowPlaying"));
    cleanup.set(null);
    return () => { cleanup.cancel(); };
  }, [isGestionale]);

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

  // Carica automaticamente i brani per genere da YouTube Data API v3.
  // Risultati cachati in localStorage per 4 ore per non consumare quota Google.
  // Ad ogni scadenza alterna casualmente tra "più ascoltati del momento" (ultimo anno)
  // e "più ascoltati di sempre" (tutti i tempi, ordinati per view totali).
  useEffect(() => {
    if (!YOUTUBE_API_KEY) {
      setLoadError("Imposta VITE_YOUTUBE_API_KEY nelle variabili Cloudflare. Uso playlist di riserva.");
      setLoadingTracks(false);
      return;
    }

    const CACHE_KEY = "rp_yt_cache";
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

    const GENRES = [
      { label: "Pop",          query: "pop music",              lang: "en" },
      { label: "Rock",         query: "rock music",             lang: "en" },
      { label: "Elettronica",  query: "electronic dance music", lang: "en" },
      { label: "Hip Hop",      query: "hip hop music",          lang: "en" },
      { label: "Reggaeton",    query: "reggaeton",              lang: "es" },
      { label: "RnB",          query: "rnb music",              lang: "en" },
      { label: "Indie",        query: "indie pop music",        lang: "en" },
      { label: "Dance",        query: "dance pop music",        lang: "en" },
    ];
    const PER_GENRE = 15;

    const isTrending = Math.random() < 0.5;
    const currentYear = new Date().getFullYear();
    const publishedAfter = isTrending ? `${currentYear - 1}-01-01T00:00:00Z` : null;

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

    const fetchSlice = ({ label, query, lang }) => {
      const q = encodeURIComponent(`${query} official music video`);
      let url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${q}&type=video&videoCategoryId=10&order=viewCount&maxResults=${PER_GENRE}&regionCode=US&relevanceLanguage=${lang}&key=${YOUTUBE_API_KEY}`;
      if (publishedAfter) url += `&publishedAfter=${publishedAfter}`;
      return fetchJsonWithRetry(url, label)
        .then((data) => {
          const hasNonLatin = (str) => /[\u0900-\u097F\u0980-\u09FF\u0A00-\u0A7F\u0A80-\u0AFF\u0B00-\u0B7F\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F\u0E00-\u0E7F\u0F00-\u0FFF\u1000-\u109F\u1100-\u11FF\u3000-\u9FFF\uA000-\uA48F\uAC00-\uD7AF\uF900-\uFAFF\u3400-\u4DBF]/.test(str);
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
          // Titoli/canali di musica indiana o asiatica spesso traslitterati in
          // caratteri latini (quindi invisibili a hasNonLatin, che guarda solo
          // l'alfabeto): li intercettiamo per parole chiave esplicite.
          const FOREIGN_KEYWORDS = /\b(bollywood|hindi|punjabi|bhojpuri|bhajan|desi|tamil|telugu|kannada|malayalam|marathi|gujarati|urdu song|pakistani song|k-?pop|kdrama|korean drama|mandarin|cantonese|chinese song|c-?pop|dangdut|indonesian song|thai song|vietnamese song|j-?pop|japanese song|anime opening|anime ending)\b/;
          const isForeignLatin = (str) => FOREIGN_KEYWORDS.test(str.toLowerCase());
          return (data.items || [])
            .filter((it) => {
              const title = it.snippet.title;
              const channel = it.snippet.channelTitle;
              return !hasNonLatin(title) && !hasNonLatin(channel) && !isSpam(title)
                && !isForeignLatin(title) && !isForeignLatin(channel);
            })
            .map((it) => ({
              id: it.id.videoId + "_" + label,
              videoId: it.id.videoId,
              title: it.snippet.title,
              artist: it.snippet.channelTitle,
              category: label,
              color: colorFor(label),
              isCustom: false,
              url: null,
            }));
        })
        .catch((err) => { console.warn(err.message || err); return []; });
    };

    // Le 8 richieste NON partono più tutte insieme: le scaglioniamo di ~300ms l'una
    // dall'altra. Sparare 8 fetch in un colpo solo (moltiplicato per tutti i visitatori
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

    runStaggered(GENRES, fetchSlice, STAGGER_MS)
      .then((arrays) => {
        const mapped = arrays.flat();
        if (!mapped.length) throw new Error("Nessun brano trovato");
        // Rimuove duplicati per videoId (stesso video in più generi o ricerche)
        const seen = new Set();
        const deduped = mapped.filter((t) => {
          if (seen.has(t.videoId)) return false;
          seen.add(t.videoId);
          return true;
        });
        const label = isTrending ? "🔥 Più ascoltati del momento" : "🏆 Più ascoltati di sempre";
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
                keepAliveLoopRef.current = false; // consumato: era solo il loop di attesa
              } else {
                setStatus("In riproduzione");
                setIsPlaying(true);
              }
            }
            if (e.data === window.YT.PlayerState.PAUSED && !keepAliveLoopRef.current && !suppressPauseRef.current) {
              // Nel gestionale la radio NON deve MAI fermarsi da sola: l'unica pausa
              // legittima è quella richiesta dall'utente col pulsante (che imposta
              // isPlaying=false PRIMA di far pausare il player, quindi qui isPlayingRef
              // è già false e cadiamo nel ramo else, innocuo). Se invece arriva un PAUSED
              // mentre l'intento è ancora "in riproduzione", è una pausa "fantasma" del
              // browser (throttling della scheda in background, transizioni dell'iframe):
              // la ignoriamo e, se siamo in primo piano, riprendiamo subito. In background
              // non insistiamo qui per non entrare in un ping-pong col browser — ci pensa
              // il gestore di visibilitychange a riprendere appena la scheda torna visibile.
              if (isGestionale && isPlayingRef.current) {
                if (document.visibilityState === "visible") ytPlayerRef.current?.playVideo?.();
              } else {
                setStatus("In pausa");
                setIsPlaying(false);
              }
            }
          },
          // Video non riproducibile (rimosso, privato, bloccato per regione, embed
          // disabilitato...): nel gestionale non restiamo bloccati sul brano morto,
          // passiamo automaticamente al successivo invece di piantare la trasmissione.
          onError: () => {
            if (isGestionale) {
              setStatus("Video non disponibile, passo al prossimo");
              goNextRef.current();
            }
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
    const id = setInterval(() => {
      if (!isPlayingRef.current || !adEvery2MinEnabled) return;
      const elapsedMs = Date.now() - lastScheduledAdAtRef.current;
      if (elapsedMs >= Math.max(1, adIntervalMinutes) * 60000) {
        lastScheduledAdAtRef.current = Date.now();
        playSpotInBackgroundRef.current();
      }
    }, 10000);
    return () => clearInterval(id);
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
      } else if (audioRef.current && audioRef.current.paused) {
        safePlayAudio(audioRef.current).catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
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
    navigator.mediaSession.setActionHandler("play", () => { unlockAdAudio(); setIsPlaying(true); });
    navigator.mediaSession.setActionHandler("pause", () => setIsPlaying(false));
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

  const pickRandomSpot = () => {
    if (AD_SPOTS.length === 1) return AD_SPOTS[0];
    let idx;
    do { idx = Math.floor(Math.random() * AD_SPOTS.length); } while (idx === lastSpotIndexRef.current);
    lastSpotIndexRef.current = idx;
    return AD_SPOTS[idx];
  };

  // Sblocca l'<audio> degli spot alla prima interazione utente diretta (click su Play),
  // sia in vista pubblica sia nel gestionale: senza questo, gli spot innescati in modo
  // "automatico" (il timer dei 2 minuti, o un evento Firebase) vengono bloccati in
  // silenzio dal browser perché non sono la diretta conseguenza di un gesto dell'utente.
  const unlockAdAudio = () => {
    if (adAudioUnlockedRef.current || !adAudioRef.current) return;
    adAudioUnlockedRef.current = true;
    const a = adAudioRef.current;
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
    const spotUrl = pickRandomSpot();
    // Abbassiamo la musica (ducking) tramite applyMusicVolume: agisce su ENTRAMBI i
    // player (YouTube + <audio>), così se il brano cambia tipo durante lo spot nessuno
    // dei due resta abbassato. Il flag isDuckingRef fa sì che anche spostando lo slider
    // durante lo spot la musica resti abbassata.
    isDuckingRef.current = true;
    applyMusicVolume();
    spotAudio.src = spotUrl;
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
    const finish = armSpotRestore(spotAudio, restore);
    const p = spotAudio.play();
    // Se il browser rifiuta il play (autoplay bloccato) ripristiniamo subito: niente
    // spot, ma almeno la musica non resta abbassata per sempre.
    if (p && p.catch) p.catch((e) => { console.warn("Spot bloccato:", e.message); finish(); });
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
      set(ref(db, "nowPlaying"), null).catch((e) => console.warn("Firebase write error:", e));
      return;
    }
    const isNewTrack = lastPublishedTrackIdRef.current !== current.id;
    lastPublishedTrackIdRef.current = current.id;
    publishNowPlaying(current, isNewTrack ? 0 : progress);
  }, [current?.id, isPlaying, isGestionale]);

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
  useEffect(() => {
    if (!isGestionale) return;
    set(ref(db, "settings/adVolume"), adVolume).catch((e) => {
      console.warn("Firebase write error:", e);
      setStatus("Errore salvataggio volume spot — controlla le regole del Realtime Database (" + e.message + ")");
    });
  }, [adVolume, isGestionale]);

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

  // Vista radio pubblica: quando arriva/finisce uno spot, abbassa/ripristina il volume
  // della canzone in corso e riproduce/interrompe lo spot in sincrono col gestionale
  useEffect(() => {
    if (isGestionale || !adAudioRef.current) return;
    const spotAudio = adAudioRef.current;

    // Se l'ascoltatore ha messo in pausa, non deve sentire spot che partono da soli:
    // niente ads mentre l'ascolto è fermo. Se lo spot era già in corso quando ha
    // premuto pausa, lo fermiamo anche noi qui.
    if (!isPlaying) {
      spotAudio.pause();
      return;
    }

    if (adTrack?.url) {
      // Rete di sicurezza: uno spot "vero" dura al massimo qualche decina di secondi.
      // Se il timestamp di partenza è più vecchio di così, non è uno spot in corso ma
      // un residuo orfano rimasto su Firebase (es. gestionale chiuso a metà spot senza
      // che onDisconnect facesse in tempo a ripulire) — lo ignoriamo, non lo riproduciamo.
      const MAX_PLAUSIBLE_SPOT_AGE_S = 90;
      const age = (Date.now() - (adTrack.startedAt || 0)) / 1000;
      if (age > MAX_PLAUSIBLE_SPOT_AGE_S) {
        // Residuo orfano: oltre a non riprodurlo, ci assicuriamo che la musica NON resti
        // abbassata (se un ducking era attivo lo togliamo), altrimenti un vecchio spot mai
        // ripulito lascerebbe l'ascoltatore col volume tagliato per sempre.
        spotAudio.pause();
        lastStartedAdKeyRef.current = null;
        isDuckingRef.current = false;
        applyMusicVolume();
        return;
      }

      // Identifica IL preciso spot in onda (url + istante di partenza).
      const adKey = adTrack.url + "|" + (adTrack.startedAt || 0);

      // Se questo esatto spot è GIÀ finito localmente ma su Firebase è ancora presente
      // (il null di fine non è ancora arrivato, o non arriverà mai perché il gestionale
      // è caduto), non rimetterlo in play e non ri-abbassare la musica: teniamo la musica
      // a volume pieno e usciamo.
      if (finishedAdKeyRef.current === adKey) {
        spotAudio.pause();
        isDuckingRef.current = false;
        applyMusicVolume();
        return;
      }

      wasPlayingBeforeAdRef.current = isPlaying;
      // Abbassiamo la musica (ducking) tramite applyMusicVolume: agisce su ENTRAMBI i
      // player (YT e <audio> locale), così se il gestionale cambia tipo di brano durante
      // lo spot nessuno dei due resta abbassato. isDuckingRef fa sì che anche spostando lo
      // slider durante lo spot la musica resti abbassata.
      isDuckingRef.current = true;
      applyMusicVolume();

      // Se è lo stesso spot di prima, l'effetto si sta solo riattivando per un motivo
      // estraneo (es. volume/adVolume cambiati) e non deve far ripartire l'audio da capo,
      // deve solo aggiornarne il volume.
      const isNewAdInstance = lastStartedAdKeyRef.current !== adKey;

      if (!isNewAdInstance) {
        spotAudio.volume = Math.min(1, volume * adVolume);
        // Se per qualche motivo si era fermato (buffering momentaneo, tab in
        // background, ecc.) lo riprendiamo dal punto esatto in cui era, SENZA
        // riavvolgerlo: prima questo ramo si limitava ad aggiornare il volume e
        // basta, quindi se lo spot restava fermo non ripartiva mai più da solo.
        if (spotAudio.paused) spotAudio.play().catch(() => {});
        return;
      }
      lastStartedAdKeyRef.current = adKey;

      if (spotAudio.src !== new URL(adTrack.url, window.location.href).href) {
        spotAudio.src = adTrack.url;
        spotAudio.load();
      }
      const startSpot = () => {
        // Ricalcolato qui (non prima) perché ora si aspetta il buffering (canplay):
        // usare un valore calcolato troppo presto renderebbe impreciso il recupero
        // del tempo trascorso per chi si collega a spot già in corso.
        const elapsed = Math.max(0, (Date.now() - (adTrack.startedAt || Date.now())) / 1000);
        // Il "recupero" del tempo trascorso si applica SOLO se questo è il primo
        // snapshot ricevuto dopo il mount (vero late-join, pagina aperta a spot già
        // in corso). Per un ascoltatore già connesso che riceve l'evento in diretta,
        // l'elapsed è solo latenza di rete/caricamento, non riproduzione reale: farlo
        // partire sempre da 0 evita che lo spot suoni tagliato all'inizio.
        const SYNC_THRESHOLD = 1.5; // secondi, soglia sotto la quale non si recupera comunque
        const shouldCatchUp = adTrack._isLateJoin && elapsed > SYNC_THRESHOLD && elapsed < (spotAudio.duration || Infinity);
        spotAudio.currentTime = shouldCatchUp ? elapsed : 0;
        // Volume dello spot proporzionale al volume generale (niente più +0.2 fisso):
        // a volume generale basso/zero, lo spot deve essere basso/zero anch'esso.
        spotAudio.volume = Math.min(1, volume * adVolume);
        spotAudio.play().catch((e) => console.warn("Spot bloccato:", e.message));
      };
      if (spotAudio.readyState >= 4) startSpot();
      else {
        // Rete di sicurezza: su connessioni molto instabili "canplaythrough" (la stima
        // del browser su "posso arrivare alla fine senza fermarmi") potrebbe non
        // arrivare mai. Meglio uno spot che rischia uno stallo che uno che non parte
        // affatto: dopo 5s si parte comunque, qualunque cosa succeda per prima.
        let started = false;
        const startOnce = () => { if (started) return; started = true; startSpot(); };
        spotAudio.addEventListener("canplaythrough", startOnce, { once: true });
        setTimeout(startOnce, 5000);
      }
    } else {
      lastStartedAdKeyRef.current = null;
      finishedAdKeyRef.current = null;
      spotAudio.pause();
      isDuckingRef.current = false;
      applyMusicVolume();
    }
  }, [adTrack, isGestionale, volume, adVolume, radioTrack, isPlaying]);

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

  // Rete di sicurezza indipendente: se lo spot in corso si ferma per un motivo
  // imprevisto (buffering, tab in background, o qualunque altra causa non ancora
  // individuata) lo si fa ripartire da SOLO, dal punto esatto in cui si era fermato
  // (mai da capo). Si attiva solo se pensiamo che uno spot dovrebbe essere ancora in
  // corso (lastStartedAdKeyRef impostato) e non è arrivato naturalmente alla fine.
  useEffect(() => {
    if (isGestionale || !adAudioRef.current) return;
    const spotAudio = adAudioRef.current;
    const onUnexpectedPause = () => {
      if (!lastStartedAdKeyRef.current) return; // nessuno spot dovrebbe essere in corso
      if (!isPlayingRef.current) return; // l'ascoltatore ha messo pausa volontariamente
      const nearEnd = spotAudio.duration && spotAudio.currentTime >= spotAudio.duration - 0.3;
      if (nearEnd) return; // finito naturalmente, arriverà l'evento "ended"
      spotAudio.play().catch(() => {});
    };
    spotAudio.addEventListener("pause", onUnexpectedPause);
    return () => spotAudio.removeEventListener("pause", onUnexpectedPause);
  }, [isGestionale]);

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
          // Al primo arrivo del brano tentiamo sempre l'autoplay (comportamento da "radio
          // live"); se il browser lo blocca perché manca un'interazione utente, isPlaying
          // resta false e l'utente vedrà il tasto Play pronto per partire manualmente.
          safePlayAudio(audioRef.current)
            .then(() => { setIsPlaying(true); setStatus("In riproduzione"); })
            .catch(() => {});
        };
        audioRef.current.addEventListener("loadedmetadata", startPlayback, { once: true });
      } else {
        // Stesso brano: se lo startedAt è cambiato, il gestionale ha fatto un seek
        // manuale (avanti/indietro) — riposizioniamo l'audio sul nuovo punto invece
        // di ignorarlo come un semplice toggle di play/pausa.
        if (lastPublicStartedAtRef.current !== radioTrack.startedAt) {
          lastPublicStartedAtRef.current = radioTrack.startedAt;
          const elapsed = (Date.now() - radioTrack.startedAt) / 1000;
          if (elapsed >= 0 && elapsed < (audioRef.current.duration || Infinity)) {
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
        armSuppressPause();
        ytPlayerRef.current.loadVideoById({ videoId: radioTrack.videoId, startSeconds: elapsed });
        ytPlayerRef.current.unMute?.();
        ytPlayerRef.current.setVolume?.(volume * 100);
        // loadVideoById avvia sempre la riproduzione; se il browser blocca l'autoplay
        // (mancanza di interazione utente), onStateChange non passerà mai a PLAYING e
        // isPlaying resterà false: l'utente vedrà comunque il tasto Play pronto.
      } else if (isPlaying) {
        // Ogni volta che l'utente (ri)avvia manualmente l'ascolto ci risincronizziamo
        // SEMPRE al punto esatto in cui si trova la diretta in questo istante — non a
        // dove il video si era fermato — così non parte più "da un punto diverso".
        keepAliveLoopRef.current = false;
        ytPlayerRef.current.unMute?.();
        ytPlayerRef.current.setVolume?.(volume * 100);
        ytPlayerRef.current.seekTo(elapsed, true);
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
    <div style={{ minHeight: "100vh", background: BLACK, fontFamily: "'DM Sans', sans-serif", color: WHITE, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "space-between" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Lobster&family=DM+Sans:wght@400;600;700&display=swap');
        * { box-sizing: border-box; }
        @keyframes pulse { 0%,100% { opacity: 0.4; transform: scaleY(0.4); } 50% { opacity: 1; transform: scaleY(1); } }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>

      {/* Header */}
      <header style={{ width: "100%", padding: "20px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ width: 44, height: 44, borderRadius: "50%", background: WHITE, border: `2px solid ${WHITE}`, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 }}>
            <img src="/logo.png" alt="Pucciotto" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
          </div>
          <div style={{ fontFamily: "'Lobster', cursive", fontSize: "26px", color: RED }}>Radio Pucciotto</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: isLive ? "#27ae60" : "#888", boxShadow: isLive ? "0 0 6px #27ae60" : "none" }} />
          <span style={{ fontSize: "12px", color: "#888", letterSpacing: "1px" }}>{isLive ? "LIVE" : "OFFLINE"}</span>
        </div>
      </header>

      {/* Corpo centrale */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "36px", padding: "40px 28px", width: "100%", maxWidth: "480px" }}>

        {/* Player YT + equalizzatore */}
        <div style={{ position: "relative", width: 180, height: 180 }}>
          <div style={{ width: 180, height: 180, borderRadius: "50%", background: `radial-gradient(circle, ${publicTrack?.color || RED}33, ${BLACK})`, border: `3px solid ${publicTrack?.color || RED}55`, display: "flex", alignItems: "center", justifyContent: "center", animation: isPlaying && isLive ? "spin 12s linear infinite" : "none" }}>
            <div style={{ width: 60, height: 60, borderRadius: "50%", background: BLACK, display: "flex", alignItems: "center", justifyContent: "center" }}>
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
              <div style={{ fontSize: "11px", color: publicTrack?.color || RED, letterSpacing: "2px", fontWeight: 700, marginBottom: "10px", textTransform: "uppercase" }}>{publicTrack?.category || "—"}</div>
              <div style={{ fontSize: "22px", fontWeight: 700, lineHeight: 1.2, marginBottom: "8px" }}>{publicTrack?.title}</div>
              <div style={{ fontSize: "15px", color: "#aaa" }}>{publicTrack?.artist || ""}</div>
            </>
          ) : (
            <>
              <div style={{ fontSize: "11px", color: "#888", letterSpacing: "2px", fontWeight: 700, marginBottom: "10px", textTransform: "uppercase" }}>Radio Pucciotto</div>
              <div style={{ fontSize: "22px", fontWeight: 700, lineHeight: 1.2, marginBottom: "8px" }}>In attesa della diretta...</div>
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
              setIsPlaying((p) => !p);
            }}
            disabled={!isLive}
            aria-label={isPlaying ? "Pausa" : "Play"}
            style={{ width: 64, height: 64, borderRadius: "50%", background: isLive ? RED : "#444", border: "none", cursor: isLive ? "pointer" : "not-allowed", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: isLive ? `0 0 20px ${RED}55` : "none" }}>
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
      <div style={{ width: "100%", background: "rgba(192,57,43,0.15)", borderTop: "1px solid rgba(192,57,43,0.2)", padding: "10px 28px", display: "flex", alignItems: "center", gap: "10px" }}>
        <span style={{ background: RED, color: WHITE, padding: "2px 8px", borderRadius: "5px", fontSize: "10px", fontWeight: 700, letterSpacing: "1px", flexShrink: 0 }}>SPONSOR</span>
        <span key={adLine} style={{ fontSize: "13px", color: "#aaa" }}>{AD_LINES[adLine]}</span>
      </div>

      {/* Footer */}
      <footer style={{ width: "100%", padding: "12px 28px", textAlign: "center", fontSize: "10px", color: "#444" }}>
        Radio Pucciotto — musica © dei rispettivi titolari, via YouTube
      </footer>

      <audio ref={audioRef} onTimeUpdate={handleTimeUpdate}
        onEnded={() => setIsPlaying(false)}
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
            <input type="range" min="0" max="1" step="0.05" value={adVolume} onChange={(e) => setAdVolume(parseFloat(e.target.value))} style={{ flex: 1, accentColor: RED }} />
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
