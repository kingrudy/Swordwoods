# Swordwoods (multiplayer)

3D bos-avontuur in de browser. Speel samen in een kamer, hak bomen om, open kisten met zwaarden,
jaag op dieren om niet te verhongeren en versla steeds sterkere golven monsters.

## Starten

    docker compose up -d --build
    # open http://<server-ip>:8304

Zonder compose:

    docker build -t swordwoods .
    docker run -d --name swordwoods -p 8304:8304 -v swordwoods-data:/data --restart unless-stopped swordwoods

De build heeft geen internet of npm nodig: three.js (r170) zit in `public/vendor/three/`,
de server gebruikt alleen ingebouwde Node-modules (Node 22).

## Spelregels
- **Account**: maak een account in het startscherm. Voortgang (zwaarden, hout, vlees, statistieken) wordt op de server bewaard in `/data/db.json`.
- **Lobby**: kies een vaste kamer, maak een eigen kamer (2-8 spelers) of druk op "Snel spelen".
- **Golven**: 45 s na het openen van een kamer komt golf 1. Zodra de laatste vijand van een golf dood is, komt de volgende golf **na 2 minuten**. Elke golf heeft meer en sterkere monsters (meer levens en schade). Elke 5e golf bevat een baas. Als iedereen valt, begint dezelfde golf opnieuw.
- **Honger**: je honger loopt terug (zo'n 7,5 minuut van vol naar leeg). Bij 0 verlies je gezondheid. Doden van konijnen (1 vlees), herten (3) en everzwijnen (4, vechten terug) levert vlees op; `R` eet een stuk (+30 honger, +8 gezondheid). Bij 80+ honger doe je 15% meer schade.
- **Kisten**: staan verspreid, herkenbaar aan een lichtzuil. Hoe verder van het startpunt, hoe beter de kans op een zeldzaam zwaard. Ze vullen zich na 10 minuten weer, bomen groeien na 4 minuten terug.
- **Dood**: je respawnt na 8 seconden en verliest de helft van je hout.
- **Medespelers vinden**: elke andere speler heeft een lichtzuil in zijn eigen kleur met zijn naam erbij, door de mist heen te zien. Staat iemand vlakbij (binnen zo'n 10 meter), dan vervaagt de zuil. Van gevallen spelers is de zuil gedimd.
- **Hond**: in elke wereld zwerven drie honden, ver van het startpunt. Je hoort ze blaffen als je in de buurt komt. Geef er een een stuk vlees (`E` of de X-knop) en hij is van jou: hij krijgt een naam, loopt voortaan in elke kamer met je mee en is aan je account gekoppeld. Hij valt monsters aan en helpt bij het jagen op dieren die jij raakt (de buit is voor jou). Monsters vallen hem ook aan; raakt hij uitgeschakeld, dan rust hij 20 seconden en staat weer op. Met elke beet en elke overwinning krijgt hij ervaring, tot niveau 10 (meer levens en schade). Een getemde zwerfhond komt na drie minuten ergens anders terug, zodat anderen er ook een kunnen vinden.
- **Vissen**: koop een vishengel in de winkel (25 hout). Sta aan de waterkant, kijk naar het water en druk `E` (mobiel: X). Gaat de dobber onder, dan heb je 2 seconden om `E` te drukken; te vroeg of te laat en de vis is weg. Soms vang je een goudvis (telt voor 3). Weglopen haalt de dobber binnen.
- **Hond voeren**: `G` (mobiel: 🐟, controller: D-pad omhoog) geeft je hond een vis: 60 seconden 50% meer schade, sneller bijten en rennen, volle gezondheid en 10 ervaring. Meerdere vissen tellen op tot 3 minuten. Een uitgeschakelde hond staat er meteen weer mee op.
- **Winkel**: dicht bij het startpunt staat een kraam van Handelaar Bram (blauwe lichtzuil, en een pijl met afstand in je scherm). Alles betaal je met hout: vlees, helende drankjes (`Q`, max. 5), schilden (12/24/36% minder schade), bijl-upgrades (hakt en slaat harder) en willekeurige zwaarden van een gekozen zeldzaamheid (30 tot 600 hout). De server controleert prijs en afstand. Hout krijg je van bomen, kisten en na elke gewonnen golf.

**Graphics**: een dag-en-nachtcyclus van 20 minuten (voor iedereen gelijk) met zonsopkomst en -ondergang, sterren, maan, vuurvliegjes en een verlichte winkel 's nachts. Water met golven, zonneglinstering en schuim langs de kust; gras en bladeren bewegen in de wind; gloed rond fel licht; monsters flitsen rood als je ze raakt. In het pauzemenu kies je Laag, Middel of Hoog; telefoons starten op Laag en het spel zet zichzelf een stap lager als het te traag loopt (tenzij je zelf iets kiest). Voor een vaste tijd om te testen: `?tijd=0.85` (0 = zonsopkomst, 0.35 = middag, 0.7 = zonsondergang, 0.85 = nacht).

**Figuren**: spelers, monsters en de handelaar zijn geanimeerde 3D-figuren uit de KayKit-pakketten van Kay Lousberg (CC0, [kaylousberg.com](https://kaylousberg.com)). In de lobby kies je je held (Ridder, Barbaar, Magiër of Schurk); zo zien anderen je. Kobolds zijn skeletten die uit de grond opstaan, aanvallen, reageren op treffers en omvallen. Het Bosmonster en de baas (Woudreus, elke 5e golf, 10 m hoog met een andere huid) zijn het 'Forest Monster' van Čestmír Dammer (CC0, kelgar.org), met lopen, aanvallen en sterven. De bestanden staan uitgedund in `public/models/` (alle figuren delen één animatiebestand); `tools/glb-slim.mjs` is het script waarmee ze zijn verkleind. Herten zijn een geanimeerde hinde van dezelfde maker en de kisten zijn de 'WoW style chest' van Nobiax (CC0) met een deksel die echt openklapt. De Skeletschutter (met de kruisboog uit het Adventurers-pakket), de Hondenjager (Skeleton Warrior) en de Sluiper (Rogue Hooded) komen ook uit KayKit. Wolven, de hond, konijnen en everzwijnen zijn nog zelfgebouwde figuren.

**Telefoon en tablet**: open dezelfde link in de browser en speel liggend. In beeld staat een gamepad: links de stick om te lopen (ver duwen = rennen, of tik ergens links en de stick springt naar je duim), rechts sleep je om te kijken. Knoppen: A slaan, B springen, X gebruiken (kist of winkel), Y eten, 🧪 drankje, L rennen aan/uit, R volgend wapen, 📨 uitnodigen en ☰ menu. Op mobiel staan de graphics lichter.

**Controller**: een echte gamepad (Xbox, PlayStation, of een Bluetooth-controller op je telefoon) werkt ook. Linkerstick lopen, rechterstick kijken, A/RT slaan (vasthouden = zware slag), B springen, X gebruiken, Y eten, LT blokkeren, LB rollen, RB wapen wisselen, D-pad links drank, linkerstick indrukken rennen, Start pauze. Zodra een controller verbonden is, verdwijnt de overlay.

**Vrienden uitnodigen**: via 📨 in de lobby, in het pauzemenu of op het scherm. Je krijgt een link naar jouw kamer die je via WhatsApp, het deelmenu van je telefoon of kopiëren verstuurt. Wie de link opent, logt in of maakt een account en komt direct in jouw kamer.

**Niveaus en talenten**: alles wat je doet levert ervaring op (monsters, dieren, bomen, kisten, vissen, erts, bouwen, golven en opdrachten). Elk nieuw niveau (tot 30) geeft een talentpunt dat je in het pauzemenu (tab Talenten) of in de lobby besteedt: Kracht (meer schade), Taaiheid (meer levens), Vlugheid (sneller lopen en rollen), IJzeren maag (minder honger), Houthakker (meer hout), Mijnwerker (meer erts) en Baasje (sterkere hond). Opnieuw verdelen kan altijd gratis.

**Dagelijkse opdrachten**: elke dag (Nederlandse tijd) krijg je drie opdrachten, zoals "Versla 25 monsters" of "Vang 5 vissen". Ze staan rechts in beeld, in het pauzemenu en in de lobby. Voltooi je er een, dan krijg je meteen hout en ervaring.

**Smid en erts**: naast de winkel staat Smid Gerrit. In het bos liggen ertsaders, rotsen met glinsterende kristallen (op de kaart als 🔷 zodra je ze gezien hebt). Sla erop om erts te hakken (een zware slag geeft meer kans; een ader is na een paar keer leeg en groeit na 5 minuten terug). Bij de smid smeed je een zwaard tot +5 (elke stap ±10% meer schade) of smelt je een oud zwaard om tot erts.

**Prestaties**: in de lobby staan 20 prestaties, van "Eerste bloed" tot "Koning van het woud" (golf 20). Anderen in je kamer zien het als je er een haalt.

**Vechten**: tik kort voor een gewone slag; **houd de muisknop (of A) vast** tot het kruisje oranje wordt en laat los voor een **zware slag**: ruim twee keer zoveel schade, raakt tot vier vijanden in een boog en duwt ze terug. Met de **rechtermuisknop** (mobiel 🛡️, controller LT) blokkeer je met je schild: van voren 70% minder schade en pijlen helemaal, maar je loopt langzamer en kunt niet slaan. Met **C** (mobiel 🌀, controller LB) maak je een **ontwijkrol**: een halve seconde onkwetsbaar, eens per seconde.

**Monsters**: naast kobolds, wolven en het Bosmonster komen er vanaf golf 3 **Skeletschutters** (houden afstand en schieten met een kruisboog; ontwijk of blokkeer de pijlen), vanaf golf 5 **Sluipers** (bijna onzichtbaar tot ze dichtbij zijn, en springen dan naar voren) en vanaf golf 6 **Hondenjagers** (gaan eerst op je hond af). De **Woudreus** laat wortels onder spelers uit de grond schieten (een rode cirkel waarschuwt; rol weg of je zit even vast) en roept kobolds op. Soms heeft een golf een **modificatie**: Snelle golf, Gepantserd, Zwerm of Woeste golf, met 50% meer hout en punten als beloning.

**Bouwen**: druk op `B` (mobiel: 🔨, controller: D-pad omlaag) en kies met `1`–`7` of het scrollwiel wat je wilt bouwen. Een groen voorbeeld laat zien waar het komt (rood = kan niet: water, te steil, boom, kist of te dicht bij de winkel); klik of A plaatst het. Alles kost hout:
- 🔥 Kampvuur (10): binnen 6 m +3 gezondheid per seconde en de helft minder honger, en licht in de nacht.
- 🕯️ Fakkel (3): licht.
- 🧱 Houten muur (8) en 🪵 Palissade (16): houden monsters tegen; muren sluiten vanzelf op elkaar aan. Monsters die vastlopen slaan het bouwwerk kapot. De palissade is sterker en verwondt monsters die erop slaan.
- 🏹 Wachttoren (45): schiet pijlen op monsters binnen 20 m.
- 🛏️ Bed (20): je respawnpunt na een val (één per speler).
Met vakje 7 (🪓) breek je je eigen bouwwerken af en krijg je tot de helft van het hout terug. In de vaste kamers blijven bouwwerken bewaard, ook na een herstart van de server (de wereld blijft dan ook dezelfde).

**Kaart en chat**: rechtsboven staat een minikaart die met je meedraait (winkel, ontdekte kisten, medespelers, je hond, gevonden zwerfhonden en monsters dichtbij). `M` of een tik op de minikaart opent de grote kaart van het hele eiland. `Enter` (mobiel: 💬) opent de kamerchat; snelberichten zoals "Help!" of "Kist gevonden!" zetten een knipperende 📍 op jouw plek op ieders kaart.

**Als app installeren**: in de lobby staat "📲 Installeer als app" (Chrome/Edge/Android). Op iPhone: deel-knop → "Zet op beginscherm". Het spel start dan schermvullend met een eigen icoon.

**Fps**: in het pauzemenu kun je een teller voor beelden per seconde aanzetten.

**Versie**: onderaan de lobby en op `/api/health` staat het versienummer. Staat daar niet de laatste versie, dan draait je server nog een oude build.

Besturing: WASD, Shift rennen, Spatie springen, muis kijken, linkermuisknop slaan/hakken, E kist openen of winkel gebruiken, R eten, Q drankje, 1-9 of scrollwiel item kiezen, Esc pauze. Werkt de muis niet vast, dan kun je slepen om te kijken.

## Beheer
- Data: volume `swordwoods-data` (bestand `db.json`). Maak hier een back-up van. Wachtwoorden zijn gehasht (scrypt).
- Zet er bij internetgebruik een reverse proxy met HTTPS voor (Caddy, Traefik, nginx). WebSockets (`/ws`) moeten doorgelaten worden. Zonder HTTPS gaan wachtwoorden onversleuteld over het netwerk.
- Instellingen via omgevingsvariabelen: `PORT` (standaard 8304; de server luistert daarnaast op `EXTRA_PORTS`, standaard 8080 en 8787), `DATA_DIR`, `FIRST_WAVE_DELAY`, `WAVE_GAP`, `HUNGER_RATE`, `MAX_SPEED`. Voor testen: `ALLOW_CHEATS=1` zet chatcommando's aan (`/spawn <type> [aantal]`, `/golf [modificatie]`, `/hout <n>`, `/erts <n>`, `/xp <n>`, `/zwaard <0-4>`, `/god`); nooit aanzetten op een openbare server.
- Gezondheidscheck: `/api/health`. Ranglijst: `/api/leaderboard`.
- De positie van spelers wordt door de client bepaald; de server controleert gevechten, loot, honger én snelheid: wie sneller beweegt dan rennen (`MAX_SPEED`, standaard 12 m/s) wordt teruggezet. Chat is beperkt tot 140 tekens en één bericht per 0,8 seconde.
