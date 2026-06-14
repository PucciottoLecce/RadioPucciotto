import React, { useState, useRef, useEffect, useMemo } from "react";
import { Play, Pause, SkipForward, SkipBack, Volume2, Trash2, Shuffle, Music } from "lucide-react";

const JAMENDO_CLIENT_ID = "cd925797";
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
  const [tracks, setTracks] = useState(FALLBACK_TRACKS);
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

  // Carica da Jamendo
  useEffect(() => {
    const colorFor = (() => {
      const map = {};
      let i = 0;
      return (cat) => {
        if (!map[cat]) { map[cat] = COLOR_PALETTE[i % COLOR_PALETTE.length]; i++; }
        return map[cat];
      };
    })();

    const GENRES = [
      { label: "Pop",        offset: 0 },
      { label: "Rock",       offset: 10 },
      { label: "Elettronica", offset: 20 },
      { label: "Jazz",       offset: 30 },
      { label: "Classica",   offset: 40 },
      { label: "Hip Hop",    offset: 50 },
    ];
    const PER_GENRE = 8;

    const fetchSlice = ({ label, offset }) =>
      fetch(`https://api.jamendo.com/v3.0/tracks/?client_id=${JAMENDO_CLIENT_ID}&format=json&limit=${PER_GENRE}&order=popularity_total&offset=${offset}`)
        .then((r) => r.json())
        .then((data) =>
          (data.results || []).map((t) => ({
            id: t.id + "_" + label,
            title: t.name,
            artist: t.artist_name,
            category: label,
            url: t.audio,
            color: colorFor(label),
            isCustom: false,
          }))
        )
        .catch(() => []);

    Promise.all(GENRES.map(fetchSlice))
      .then((arrays) => {
        const mapped = arrays.flat();
        if (!mapped.length) throw new Error("Nessun brano trovato");
        setTracks(mapped);
        setLoadingTracks(false);
      })
      .catch(() => {
        setLoadError("Impossibile caricare i brani da Jamendo. Uso playlist di riserva.");
        setLoadingTracks(false);
      });
  }, []);

  // Categorie derivate sempre in modo reattivo, senza state separato
  const categories = useMemo(() => {
    const genreCats = [...new Set(tracks.map((t) => t.category))];
    const cats = ["Tutti", ...genreCats];
    if (customTracks.length > 0) cats.push("Le mie canzoni");
    return cats;
  }, [tracks, customTracks]);

  useEffect(() => { setCurrentIndex(0); }, [category]);

  useEffect(() => {
    const id = setInterval(() => { if (isPlaying) playSpotInBackground(); }, 120000);
    return () => clearInterval(id);
  }, [isPlaying, volume]);

  useEffect(() => {
    const id = setInterval(() => setAdLine((a) => (a + 1) % AD_LINES.length), 6000);
    return () => clearInterval(id);
  }, []);

  // Ref che tiene traccia se vogliamo riprodurre appena il brano è pronto
  const shouldPlayRef = useRef(false);

  // Quando cambia il volume
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  // Quando cambia isPlaying (senza cambiare brano)
  useEffect(() => {
    if (!audioRef.current) return;
    if (isPlaying) {
      shouldPlayRef.current = true;
      const p = audioRef.current.play();
      if (p && p.then) {
        p.then(() => setStatus("In riproduzione"))
         .catch(() => {}); // onCanPlay gestirà il play se il file non è ancora pronto
      }
    } else {
      shouldPlayRef.current = false;
      audioRef.current.pause();
      setStatus("In pausa");
    }
  }, [isPlaying]);

  // Quando cambia il brano: carica e aspetta onCanPlay per fare play
  useEffect(() => {
    if (!audioRef.current || !current?.url) return;
    audioRef.current.src = current.url;
    audioRef.current.load();
    setStatus("Caricamento...");
    setProgress(0);
    setDuration(0);
  }, [current?.url]);

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
    if (!adAudioRef.current || !audioRef.current) return;
    const musicAudio = audioRef.current;
    const spotAudio = adAudioRef.current;
    const originalVolume = volume;
    musicAudio.volume = originalVolume * 0.5;
    spotAudio.src = pickRandomSpot();
    spotAudio.currentTime = 0;
    spotAudio.volume = Math.min(1, originalVolume + 0.2);
    spotAudio.play().catch((e) => console.warn("Spot bloccato:", e.message));
    const restore = () => { musicAudio.volume = originalVolume; spotAudio.removeEventListener("ended", restore); };
    spotAudio.addEventListener("ended", restore);
  };

  const playSpotSolo = () => {
    if (!adAudioRef.current || !audioRef.current) return;
    const musicAudio = audioRef.current;
    const spotAudio = adAudioRef.current;
    musicAudio.pause();
    spotAudio.src = pickRandomSpot();
    spotAudio.currentTime = 0;
    spotAudio.volume = Math.min(1, volume + 0.2);
    spotAudio.play().catch((e) => console.warn("Spot bloccato:", e.message));
    const restore = () => { musicAudio.play().catch(() => {}); spotAudio.removeEventListener("ended", restore); };
    spotAudio.addEventListener("ended", restore);
  };

  const formatTime = (s) => {
    if (!s || isNaN(s)) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const pct = duration ? (progress / duration) * 100 : 0;

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
      `}</style>

      {/* Header */}
      <header style={{ padding: "20px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid rgba(26,26,26,0.08)", background: WHITE }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ width: 44, height: 44, borderRadius: "50%", background: WHITE, border: `2px solid ${BLACK}`, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
            <img src="/logo.png" alt="Pucciotto" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
          </div>
          <div>
            <div style={{ fontFamily: "'Lobster', cursive", fontWeight: 400, fontSize: "24px", color: BLACK }}>Radio Pucciotto</div>
            <div style={{ fontSize: "11px", color: "#888", letterSpacing: "1.5px" }}>MUSICA SENZA COPYRIGHT · LIVE</div>
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
        <div style={{ padding: "8px 28px", fontSize: "12px", textAlign: "center", background: loadError ? "rgba(192,57,43,0.08)" : "rgba(26,26,26,0.04)", color: loadError ? RED : "#888" }}>
          {loadingTracks ? "Aggiornamento playlist dai brani più ascoltati..." : loadError}
        </div>
      )}

      <div style={{ flex: 1, padding: "28px", display: "flex", flexDirection: "column", gap: "24px", maxWidth: "900px", margin: "0 auto", width: "100%" }}>

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
        <div style={{ background: WHITE, borderRadius: "20px", padding: "28px", border: "1px solid rgba(26,26,26,0.08)", boxShadow: "0 4px 20px rgba(0,0,0,.04)", display: "flex", flexDirection: "column", gap: "20px" }}>
          <div style={{ display: "flex", gap: "20px", alignItems: "center" }}>
            <div style={{ width: 84, height: 84, borderRadius: "16px", background: `linear-gradient(135deg, ${current?.color || RED}, ${BLACK})`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              {current?.isCustom ? (
                <Music size={32} color={WHITE} />
              ) : (
                <div style={{ display: "flex", gap: "4px", alignItems: "center", height: "30px" }}>
                  {[0,1,2,3].map((i) => (
                    <div key={i} style={{ width: "4px", height: "100%", borderRadius: "2px", background: WHITE, animation: isPlaying ? `pulse-bar ${0.6 + i*0.15}s ease-in-out infinite` : "none", transform: isPlaying ? undefined : "scaleY(0.3)" }} />
                  ))}
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
                if (!audioRef.current || !duration) return;
                const rect = e.currentTarget.getBoundingClientRect();
                audioRef.current.currentTime = ((e.clientX - rect.left) / rect.width) * duration;
              }}>
              <div style={{ height: "100%", width: `${pct}%`, background: RED, transition: "width 0.2s linear" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "#888", marginTop: "6px" }}>
              <span>{formatTime(progress)}</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          {/* Controlli */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "20px" }}>
            <Volume2 size={18} color="#888" />
            <input type="range" min="0" max="1" step="0.05" value={volume} onChange={(e) => setVolume(parseFloat(e.target.value))} style={{ width: "70px" }} />
            <div style={{ flex: 1 }} />
            <button className="pc-btn" onClick={goPrev} style={{ background: "transparent", border: "none", color: BLACK, cursor: "pointer" }}>
              <SkipBack size={22} fill={BLACK} />
            </button>
            <button className="pc-btn" onClick={() => setIsPlaying((p) => !p)} style={{ width: 56, height: 56, borderRadius: "50%", background: RED, border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
              {isPlaying ? <Pause size={24} color={WHITE} fill={WHITE} /> : <Play size={24} color={WHITE} fill={WHITE} />}
            </button>
            <button className="pc-btn" onClick={goNext} style={{ background: "transparent", border: "none", color: BLACK, cursor: "pointer" }}>
              <SkipForward size={22} fill={BLACK} />
            </button>
            <div style={{ flex: 1 }} />
            <div style={{ fontSize: "11px", color: "#888", width: "70px", textAlign: "right" }}>Prox. spot: {playsUntilAd}</div>
          </div>

          <audio ref={audioRef} onTimeUpdate={handleTimeUpdate} onEnded={goNext}
            onError={() => setStatus("Errore nel caricamento del brano")}
            onCanPlay={() => {
              if (shouldPlayRef.current) {
                audioRef.current?.play()
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
        Radio Pucciotto — brani royalty-free · Sponsorizzato da Pucciotto
      </footer>
    </div>
  );
}
