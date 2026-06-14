# Radio Pucciotto 🎵

App web per riprodurre brani senza copyright, divisi per categorie, con
pubblicità (banner + spot audio) dedicata a "Piucciotto".

## Come avviarla

1. Scompatta lo zip e apri la cartella in VS Code
2. Apri il terminale e installa le dipendenze:
   ```
   npm install
   ```
3. Avvia il server di sviluppo:
   ```
   npm run dev
   ```
4. Apri il link mostrato nel terminale (di solito http://localhost:5173)

## Personalizzazione

- **Brani**: modifica l'array `TRACKS` in `src/App.jsx`. Sostituisci i campi
  `url` con i link diretti ai tuoi brani royalty-free (es. da Free Music
  Archive, Pixabay Music, Incompetech, file mp3 tuoi su hosting/CDN, ecc.)
- **Categorie**: modifica l'array `CATEGORIES` e il campo `category` di ogni brano
- **Pubblicità testuale**: modifica l'array `AD_LINES` (banner in alto)
- **Spot audio Piucciotto**: testo e frequenza modificabili nella sezione
  dello spot a schermo intero (variabile `playsUntilAd`, default ogni 3 brani)

## Build per la pubblicazione

```
npm run build
```
Genera la cartella `dist/` pronta per essere caricata su un hosting
(Netlify, Vercel, GitHub Pages, ecc.)
