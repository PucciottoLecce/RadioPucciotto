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
  Vanno in onda **a rotazione fissa** nell'ordine di `AD_SPOTS` (1 → 2 → 3 → 1 …),
  con la posizione ricordata nel browser del gestionale (`rp_next_spot`). Per
  aggiungere uno spot: file in `public/ads/` + una riga in fondo ad `AD_SPOTS`.

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
- **PR #5**: spot a rotazione fissa 1 → 2 → 3 → 1 … (prima erano scelti a caso,
  evitando solo di ripetere l'ultimo); la rotazione riprende da dove era rimasta
  anche dopo un ricaricamento.
- **PR #6**: la radio pubblica da smartphone sta tutta in una schermata, senza
  scorrere (verificato da 320×480 a 412×780, più finestre PC basse). Classi
  `.pub-*` nello `<style>` della vista pubblica: misure da PC invariate, e sotto
  `@media (max-width: 600px), (max-height: 700px)` misure proporzionate
  all'altezza visibile (`dvh`, con `vh` di riserva) e titoli al massimo su 2 righe.
  Il gestionale da telefono invece scorre, per via della playlist lunga.
- **PR #7**: il gestionale in background veniva ancora CONGELATO dal browser
  (scheda silenziosa → risparmio energetico): si fermava tutto, la radio andava
  OFFLINE e ripartiva da dove era rimasta solo tornando sulla scheda. Il loop di
  sottofondo del gestionale (`kickAudioEngine`) ora suona un tono a 20 Hz a −60 dBFS,
  impercettibile ma sopra la soglia "scheda muta" dei browser (circa −72 dBFS),
  anche col Muto generale. La radio degli ascoltatori è invariata (buffer di zeri).
  Rimedio aggiuntivo lato utente: in Chrome/Edge aggiungere il sito a "mantieni
  sempre attivi / non mettere in sospensione".
- **PR #8**: verificato che a fine spot la musica torni al volume di partenza
  (9 casi nel gestionale, 10 per gli ascoltatori). Corretti due problemi degli
  ascoltatori: pausa e ripresa durante uno spot lasciava la musica a metà volume;
  il passaggio del gestionale da un brano YouTube a un mp3 ("Le mie canzoni") a
  metà brano fermava gli ascoltatori (il PAUSED di YouTube veniva preso per una
  pausa loro: ora è ignorato quando in onda c'è un mp3, via `radioTrackRef`).
- **PR #9**: ogni spot parte dall'inizio e arriva alla fine. Lato ascoltatore,
  quando il gestionale chiude lo spot (`adPlaying` = null) uno spot che qui sta
  ancora suonando o partendo NON viene più tagliato: finisce da solo (rete di
  sicurezza 20 s). Prima si perdeva la coda (ascoltatore in ritardo) o quasi tutto
  lo spot (chi apriva la radio a spot iniziato). Il primo tocco sulla pagina
  (`unlockAdAudio`) non cambia più la sorgente dell'`<audio>` degli spot se sta
  suonando. Verificato in 9 casi (Web Audio, `<audio>`, gestionale).
  **ANNULLATA (PR #11, revert):** in uso reale, con lo spot che finiva sulla fine
  della canzone, l'ascoltatore si bloccava invece di far partire la nuova canzone
  sotto lo spot. Nel browser di prova (YouTube finto) il blocco non si riproduceva:
  la causa è nel comportamento del player YouTube vero. Torna il comportamento
  precedente (lo spot si ferma quando il gestionale lo chiude). Non riprovare questa
  strada senza prima riprodurre il blocco con il player vero.
- **PR #10**: canzoni indiane (punjabi) ancora presenti in "Internazionali" (la
  classifica GB ne è piena, con titoli in inglese). La verifica finale
  (`keepPlayable`, `videos.list part=snippet,status,contentDetails`, stessa quota)
  scarta anche in base alla **lingua dell'audio** dichiarata (`BLOCKED_LANGS`:
  indiane, russe/ex URSS, asiatiche, arabe, africane, tedesco) e a **descrizione ed
  etichette** (alfabeti non latini, parole chiave). Aggiunte etichette/artisti
  punjabi alle parole chiave. Cache `rp_yt_cache_eu_am_v5`.
- **Per tornare indietro:** fare il revert del commit di merge della PR su `main`
  (Cloudflare ripubblica da solo).
- La chiave della cache della playlist nel browser (`CACHE_KEY`, ora
  `rp_yt_cache_eu_am_v5`) va cambiata ogni volta che cambiano fonti o filtri,
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
