import React, { useState, useRef, useEffect, useMemo } from "react";
import { Play, Pause, SkipForward, SkipBack, Volume2, Trash2, Shuffle, Music } from "lucide-react";
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
  const [adLine, setAdLine] = useState(0);
  const [playsUntilAd, setPlaysUntilAd] = useState(3);
  const [status, setStatus] = useState("Pronto");
  const [shuffleMode, setShuffleMode] = useState(false);
  // La playlist shuffled è salvata in state, NON ricalcolata ad ogni render
  const [shuffledList, setShuffledList] = useState([]);

  const lastSpotIndexRef = useRef(-1);
  const audioRef = useRef(null);
  const adAudioRef = useRef(null);
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
  const armSuppressPause = () => {
    suppressPauseRef.current = true;
    if (suppressPauseTimeoutRef.current) clearTimeout(suppressPauseTimeoutRef.current);
    // Rete di sicurezza: se dopo 2.5s non è arrivato un vero PLAYING (es. autoplay
    // bloccato dal browser), torniamo a fidarci dei PAUSED per non restare "sordi"
    // a un blocco reale che richiede all'utente di premere Play.
    suppressPauseTimeoutRef.current = setTimeout(() => { suppressPauseRef.current = false; }, 2500);
  };

  // Determina modalità all'avvio: ?gestionale nell'URL = pannello admin
  const isGestionale = window.location.search.includes("gestionale");

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

  // Se il gestionale si chiude/ricarica/perde la connessione MENTRE uno spot è in
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
              (title.match(/#\w+/g) || []).length >= 2 ||
              (title.match(/[|•·—–]/g) || []).length >= 2 ||
              /\d{4}.*\d{4}/.test(t)
            );
          };
          return (data.items || [])
            .filter((it) => {
              const title = it.snippet.title;
              const channel = it.snippet.channelTitle;
              return !hasNonLatin(title) && !hasNonLatin(channel) && !isSpam(title);
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
            // goNext() gestisce anche la logica dello spot pubblicitario locale (playSpotSolo):
            // deve girare SOLO nel gestionale, altrimenti in vista pubblica un video che finisce
            // può far scattare uno spot non sincronizzato e bloccare/disallineare il video.
            if (e.data === window.YT.PlayerState.ENDED) {
              if (isGestionale) {
                goNext();
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
              setStatus("In pausa");
              setIsPlaying(false);
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
  useEffect(() => {
    if (!isGestionale) return;
    const id = setInterval(() => { if (isPlaying) playSpotInBackground(); }, 120000);
    return () => clearInterval(id);
  }, [isPlaying, volume, isGestionale]);

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

  // Quando cambia il volume
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
    ytPlayerRef.current?.setVolume?.(volume * 100);
  }, [volume]);

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

  // Pubblica il brano corrente su Firebase (solo dal gestionale)
  const publishNowPlaying = (track) => {
    if (!track || !isGestionale) return;
    set(ref(db, "nowPlaying"), {
      videoId: track.videoId || null,
      url: track.url || null,
      title: track.title,
      artist: track.artist,
      category: track.category,
      color: track.color,
      isCustom: track.isCustom || false,
      startedAt: Date.now(),
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
    setPlaysUntilAd((p) => { if (p <= 1) { playSpotSolo(); return 3; } return p - 1; });
    setCurrentIndex((i) => (i + 1) % filtered.length);
    setProgress(0);
    setIsPlaying(true);
  };

  const goPrev = () => {
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

  const playSpotInBackground = () => {
    if (!adAudioRef.current) return;
    const spotAudio = adAudioRef.current;
    const isYT = current && !current.isCustom;
    const originalVolume = volume;
    const spotUrl = pickRandomSpot();
    if (isYT) ytPlayerRef.current?.setVolume?.(originalVolume * 50);
    else if (audioRef.current) audioRef.current.volume = originalVolume * 0.5;
    spotAudio.src = spotUrl;
    spotAudio.currentTime = 0;
    spotAudio.volume = Math.min(1, originalVolume + 0.2);
    spotAudio.play().catch((e) => console.warn("Spot bloccato:", e.message));
    publishAdPlaying(spotUrl);
    const restore = () => {
      if (isYT) ytPlayerRef.current?.setVolume?.(originalVolume * 100);
      else if (audioRef.current) audioRef.current.volume = originalVolume;
      publishAdPlaying(null);
      spotAudio.removeEventListener("ended", restore);
    };
    spotAudio.addEventListener("ended", restore);
  };

  const playSpotSolo = () => {
    if (!adAudioRef.current) return;
    const spotAudio = adAudioRef.current;
    const isYT = current && !current.isCustom;
    const spotUrl = pickRandomSpot();
    if (isYT) ytPlayerRef.current?.pauseVideo?.();
    else audioRef.current?.pause();
    spotAudio.src = spotUrl;
    spotAudio.currentTime = 0;
    spotAudio.volume = Math.min(1, volume + 0.2);
    spotAudio.play().catch((e) => console.warn("Spot bloccato:", e.message));
    publishAdPlaying(spotUrl);
    const restore = () => {
      if (isYT) ytPlayerRef.current?.playVideo?.();
      else audioRef.current?.play().catch(() => {});
      publishAdPlaying(null);
      spotAudio.removeEventListener("ended", restore);
    };
    spotAudio.addEventListener("ended", restore);
  };

  // Gestionale: pubblica su Firebase ogni volta che current cambia, o quando si preme Play
  // sul brano già selezionato (senza isPlaying nelle dipendenze, il click su Play da solo
  // non ripubblicava nulla se il brano non cambiava — questo è il motivo per cui la radio
  // pubblica restava su "In attesa della diretta...").
  useEffect(() => {
    if (isGestionale && current && isPlaying) {
      publishNowPlaying(current);
    }
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

  // Vista radio pubblica: ascolta lo spot in onda pubblicato dal gestionale via Firebase
  useEffect(() => {
    if (isGestionale) return;
    const adPlayingRef = ref(db, "adPlaying");
    const unsub = onValue(adPlayingRef, (snapshot) => {
      setAdTrack(snapshot.val());
    });
    return () => unsub();
  }, [isGestionale]);

  // Vista radio pubblica: quando arriva/finisce uno spot, abbassa/ripristina il volume
  // della canzone in corso e riproduce/interrompe lo spot in sincrono col gestionale
  useEffect(() => {
    if (isGestionale || !adAudioRef.current) return;
    const spotAudio = adAudioRef.current;
    const isYT = radioTrack && !radioTrack.isCustom;

    if (adTrack?.url) {
      // Rete di sicurezza: uno spot "vero" dura al massimo qualche decina di secondi.
      // Se il timestamp di partenza è più vecchio di così, non è uno spot in corso ma
      // un residuo orfano rimasto su Firebase (es. gestionale chiuso a metà spot senza
      // che onDisconnect facesse in tempo a ripulire) — lo ignoriamo, non lo riproduciamo.
      const MAX_PLAUSIBLE_SPOT_AGE_S = 90;
      const age = (Date.now() - (adTrack.startedAt || 0)) / 1000;
      if (age > MAX_PLAUSIBLE_SPOT_AGE_S) {
        spotAudio.pause();
        return;
      }

      wasPlayingBeforeAdRef.current = isPlaying;
      if (isYT) ytPlayerRef.current?.setVolume?.(volume * 50);
      else if (audioRef.current) audioRef.current.volume = volume * 0.5;

      const elapsed = Math.max(0, (Date.now() - (adTrack.startedAt || Date.now())) / 1000);
      if (spotAudio.src !== new URL(adTrack.url, window.location.href).href) {
        spotAudio.src = adTrack.url;
        spotAudio.load();
      }
      const startSpot = () => {
        // Il "recupero" del tempo trascorso (per sincronizzarsi con chi si collega a
        // spot già iniziato) si applica solo oltre una soglia minima: il normale
        // ritardo di rete/caricamento (qualche centinaio di ms, anche 1s) NON deve far
        // saltare in avanti l'audio, altrimenti si perdono le prime parole dello spot.
        const SYNC_THRESHOLD = 1.5; // secondi
        spotAudio.currentTime = (elapsed > SYNC_THRESHOLD && elapsed < (spotAudio.duration || Infinity)) ? elapsed : 0;
        spotAudio.volume = Math.min(1, volume + 0.2);
        spotAudio.play().catch((e) => console.warn("Spot bloccato:", e.message));
      };
      if (spotAudio.readyState >= 1) startSpot();
      else spotAudio.addEventListener("loadedmetadata", startSpot, { once: true });
    } else {
      spotAudio.pause();
      if (isYT) ytPlayerRef.current?.setVolume?.(volume * 100);
      else if (audioRef.current) audioRef.current.volume = volume;
    }
  }, [adTrack, isGestionale, volume, radioTrack]);

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
        // Stesso brano: applica solo lo stato play/pausa richiesto dall'utente
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
              // Sblocca l'<audio> degli spot alla prima interazione dell'utente, così
              // quando arriva un evento "adPlaying" da Firebase il browser lo lascia partire
              if (!adAudioUnlockedRef.current && adAudioRef.current) {
                adAudioUnlockedRef.current = true;
                const a = adAudioRef.current;
                const wasMuted = a.muted;
                // IMPORTANTE: il tag <audio> degli spot non ha una src finché non
                // arriva il primo evento "adPlaying" da Firebase. Chiamare play()
                // senza sorgente falliva subito (nessun contenuto da riprodurre) e
                // lo "sblocco" non avveniva davvero: il browser continuava a
                // bloccare gli spot successivi innescati da Firebase (senza gesto
                // utente diretto). Impostando qui una src reale (uno spot vero),
                // il play muto va a buon fine e l'elemento resta sbloccato.
                a.src = AD_SPOTS[0];
                a.muted = true;
                a.play().then(() => { a.pause(); a.currentTime = 0; a.muted = wasMuted; })
                  .catch(() => { a.muted = wasMuted; });
              }
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
            <div style={{ width: 84, height: 84, borderRadius: "16px", overflow: "hidden", background: BLACK, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              {current?.isCustom ? (
                <div style={{ width: "100%", height: "100%", borderRadius: "16px", background: `linear-gradient(135deg, ${current?.color || RED}, ${BLACK})`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Music size={32} color={WHITE} />
                </div>
              ) : (
                <div id="yt-player" />
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
              <Volume2 size={18} color="#888" />
              <input type="range" min="0" max="1" step="0.05" value={volume} onChange={(e) => setVolume(parseFloat(e.target.value))} style={{ width: "70px" }} />
            </div>
            <div className="ctrl-spacer" style={{ flex: 1 }} />
            <div className="nav-controls" style={{ display: "flex", alignItems: "center", gap: "20px", flexShrink: 0 }}>
              <button className="pc-btn" onClick={goPrev} style={{ background: "transparent", border: "none", color: BLACK, cursor: "pointer", flexShrink: 0 }}>
                <SkipBack size={22} fill={BLACK} />
              </button>
              <button className="pc-btn" onClick={() => setIsPlaying((p) => !p)} style={{ width: 56, height: 56, minWidth: 56, minHeight: 56, borderRadius: "50%", background: RED, border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
                {isPlaying ? <Pause size={24} color={WHITE} fill={WHITE} /> : <Play size={24} color={WHITE} fill={WHITE} />}
              </button>
              <button className="pc-btn" onClick={goNext} style={{ background: "transparent", border: "none", color: BLACK, cursor: "pointer", flexShrink: 0 }}>
                <SkipForward size={22} fill={BLACK} />
              </button>
            </div>
            <div className="ctrl-spacer" style={{ flex: 1 }} />
            <div className="ad-counter" style={{ fontSize: "11px", color: "#888", width: "70px", textAlign: "right", flexShrink: 0 }}>Prox. spot: {playsUntilAd}</div>
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
