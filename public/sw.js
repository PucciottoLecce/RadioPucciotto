// Service worker minimo: serve SOLO a rendere l'app installabile (PWA / "Aggiungi a
// schermata Home"). Di proposito NON mette in cache nulla: ogni richiesta va sempre in
// rete, così dopo un aggiornamento non rischi mai di vederti servita una versione vecchia
// dell'app. La radio ha comunque bisogno della rete per funzionare (YouTube/Firebase/mp3).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
// Handler "fetch" presente ma passivo: non chiamiamo respondWith(), quindi il browser usa
// la sua gestione di rete predefinita. Basta la sua presenza a soddisfare i requisiti di
// installabilità su alcuni browser, senza introdurre logica di cache.
self.addEventListener("fetch", () => {});
