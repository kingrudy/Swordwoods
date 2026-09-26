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
- **Winkel**: dicht bij het startpunt staat een kraam van Handelaar Bram (blauwe lichtzuil, en een pijl met afstand in je scherm). Alles betaal je met hout: vlees, helende drankjes (`Q`, max. 5), schilden (12/24/36% minder schade), bijl-upgrades (hakt en slaat harder) en willekeurige zwaarden van een gekozen zeldzaamheid (30 tot 600 hout). De server controleert prijs en afstand. Hout krijg je van bomen, kisten en na elke gewonnen golf.

**Telefoon en tablet**: open dezelfde link in de browser en speel liggend. In beeld staat een gamepad: links de stick om te lopen (ver duwen = rennen, of tik ergens links en de stick springt naar je duim), rechts sleep je om te kijken. Knoppen: A slaan, B springen, X gebruiken (kist of winkel), Y eten, 🧪 drankje, L rennen aan/uit, R volgend wapen, 📨 uitnodigen en ☰ menu. Op mobiel staan de graphics lichter.

**Controller**: een echte gamepad (Xbox, PlayStation, of een Bluetooth-controller op je telefoon) werkt ook. Linkerstick lopen, rechterstick kijken, A/RT slaan, B springen, X gebruiken, Y eten, LT drank, LB/RB wapen wisselen, linkerstick indrukken rennen, Start pauze. Zodra een controller verbonden is, verdwijnt de overlay.

**Vrienden uitnodigen**: via 📨 in de lobby, in het pauzemenu of op het scherm. Je krijgt een link naar jouw kamer die je via WhatsApp, het deelmenu van je telefoon of kopiëren verstuurt. Wie de link opent, logt in of maakt een account en komt direct in jouw kamer.

**Versie**: onderaan de lobby en op `/api/health` staat het versienummer. Staat daar niet de laatste versie, dan draait je server nog een oude build.

Besturing: WASD, Shift rennen, Spatie springen, muis kijken, linkermuisknop slaan/hakken, E kist openen of winkel gebruiken, R eten, Q drankje, 1-9 of scrollwiel item kiezen, Esc pauze. Werkt de muis niet vast, dan kun je slepen om te kijken.

## Beheer
- Data: volume `swordwoods-data` (bestand `db.json`). Maak hier een back-up van. Wachtwoorden zijn gehasht (scrypt).
- Zet er bij internetgebruik een reverse proxy met HTTPS voor (Caddy, Traefik, nginx). WebSockets (`/ws`) moeten doorgelaten worden. Zonder HTTPS gaan wachtwoorden onversleuteld over het netwerk.
- Instellingen via omgevingsvariabelen: `PORT` (standaard 8304; de server luistert daarnaast op `EXTRA_PORTS`, standaard 8080 en 8787), `DATA_DIR`, `FIRST_WAVE_DELAY`, `WAVE_GAP`, `HUNGER_RATE`.
- Gezondheidscheck: `/api/health`. Ranglijst: `/api/leaderboard`.
- De positie van spelers wordt door de client bepaald (de server controleert gevechten, loot en honger). Prima onder vrienden, niet bedoeld tegen valsspelers.
