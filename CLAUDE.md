# Radio Pucciotto — memoria del progetto

Note per chi lavora su questo repository (persone o Claude). Rispondere al
proprietario **in italiano**, in modo semplice e senza gergo tecnico.

## Come funziona

- App React + Vite, quasi tutto in `src/App.jsx`. Pubblicata su **Cloudflare
  Pages** da `main`. La variabile `VITE_YOUTUBE_API_KEY` è impostata su Cloudflare.
- **Due modalità nella stessa pagina:**
  - `/?gestionale`: il **gestionale**. È l'unico che sceglie i brani (API YouTube)
    e trasmette su Firebase.
  - `/`: la **radio pubblica** (ascoltatori). Riceve tutto da Firebase e non usa
    l'API YouTube.
- **Firebase Realtime Database** (`src/firebase.js`, nessun login): nodi
  `nowPlaying` (brano in onda + `startedAt`), `adPlaying` (spot in onda),
  `settings/adVolume` (volume spot).
- Brani "miei": `public/my-song/index.json` + mp3. Spot audio: `public/ads/`.
- Spot: solo il meccanismo "ogni N minuti" (quello "ogni 3 canzoni" è stato tolto).

## Decisioni del proprietario (da rispettare)

- Playlist = **più ascoltati del momento e di sempre**. Categorie per paese:
  Italia, Internazionali (GB), Spagna, Francia, Americane (US), Latine (MX).
  Per ogni paese: classifica YouTube (`chart=mostPopular`) + ricerca per view totali.
- **Niente canzoni tedesche** (Germania tolta di proposito), niente
  indiane/russe/asiatiche/africane (filtri su alfabeti, parole chiave e canali in
  `toTracks`).
- La modalità **Casuale resta** così com'è: al proprietario va bene.
- Il proprietario teme di rompere quello che funziona: modifiche piccole e mirate,
  provate prima di pubblicarle, e sempre con la possibilità di tornare indietro.

## Storico delle modifiche

- **PR #2** (commit `a6f1454` su `main`): playlist per paesi europei, America e
  America Latina al posto dei generi su scala USA.
- **PR #3**:
  - Pausa "da sola" del gestionale in background: controllo ogni 5 s via Web Worker
    che fa ripartire il player; pausa dal sistema (cuffie, tasti multimediali,
    chiamate) ignorata nel gestionale; dopo 6 errori di fila riprova tra 30 s
    invece di fermarsi.
  - Playlist: solo brani riproducibili in Italia (incorporabili, non bloccati in
    IT, non vietati ai minori, pubblici). Tolta la Germania.
  - Gestionale: aprirlo non spegne più la diretta; pulizie `onDisconnect`
    ri-registrate dopo un buco di rete e brano ripubblicato subito; volume spot
    letto da Firebase (non più riportato al 70%); minuti e attivazione spot
    ricordati (localStorage); il tempo in pausa non conta per il prossimo spot.
  - Ascoltatori: se mettono in pausa, il brano dopo non riparte da solo; se la
    diretta si ferma, dopo 20 s (tolleranza per i buchi di rete) si ferma anche
    il loro player.
- **PR #4**: timer degli spot, battito di sincronizzazione e controllo del player
  girano su `startTicker` (Web Worker), così restano regolari anche col gestionale
  in background e silenzioso (muto generale). Uno spot scartato perché il
  precedente era ancora in corso o appena finito non fa più saltare un giro intero
  del timer. Verificati in prova: tempi degli spot, musica abbassata al 50% durante
  lo spot, volume spot = volume generale × volume spot (gestionale e ascoltatori),
  ripristino a fine spot.
- **Per tornare indietro:** fare il revert del commit di merge della PR su `main`
  (Cloudflare ripubblica da solo).
- La chiave della cache della playlist nel browser (`CACHE_KEY`, ora
  `rp_yt_cache_eu_am_v4`) va cambiata ogni volta che cambiano fonti o filtri,
  altrimenti la vecchia playlist resta per 18 ore.

## Punti ancora aperti

- **Sicurezza** (serve il proprietario): chiunque aggiunga `?gestionale`
  all'indirizzo può trasmettere; Firebase non ha login. La chiave YouTube va
  limitata al dominio del sito (Google Cloud Console → Credenziali → Referrer HTTP).
  Una protezione vera richiede login Firebase + regole del database.
- Una categoria con un solo brano si ferma a fine canzone (oggi non succede:
  tutte le categorie hanno molti brani).
- Codice non usato: `FALLBACK_TRACKS`, `removeCustomTrack`/`isBlob`.
- Non aprire due gestionali in riproduzione insieme: si contendono la diretta.

## Come provare le modifiche senza toccare la radio vera

- `npm run build`. Senza `VITE_YOUTUBE_API_KEY` Vite elimina il codice della
  ricerca YouTube: per controllarlo, fare la build con una chiave finta.
- Prove in Chromium (Playwright, `executablePath: /opt/pw-browsers/chromium`):
  - un `window.YT` finto al posto del player YouTube;
  - `firebase/database` sostituito con un modulo in memoria tramite `resolve.alias`
    in una config Vite di prova;
  - risposte dell'API YouTube simulate con `page.route`.
- **Mai** far girare il gestionale contro il Firebase vero durante le prove,
  nemmeno dalle anteprime Cloudflare delle PR: scriverebbe sulla diretta.
