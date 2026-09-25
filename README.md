# Swordwoods (multiplayer)

3D bos-avontuur in de browser. Speel samen in een kamer, hak bomen om, open kisten met zwaarden,
jaag op dieren om niet te verhongeren en versla steeds sterkere golven monsters.

## Starten

    docker compose up -d --build
    # open http://<server-ip>:8080

Zonder compose:

    docker build -t swordwoods .
    docker run -d --name swordwoods -p 8080:8080 -v swordwoods-data:/data --restart unless-stopped swordwoods

De build heeft geen internet of npm nodig: three.js (r170) zit in `public/vendor/three/`,
de server gebruikt alleen ingebouwde Node-modules (Node 22).

## Spelregels
- **Account**: maak een account in het startscherm. Voortgang (zwaarden, hout, vlees, statistieken) wordt op de server bewaard in `/data/db.json`.
- **Lobby**: kies een vaste kamer, maak een eigen kamer (2-8 spelers) of druk op "Snel spelen".
- **Golven**: 45 s na het openen van een kamer komt golf 1. Zodra de laatste vijand van een golf dood is, komt de volgende golf **na 2 minuten**. Elke golf heeft meer en sterkere monsters (meer levens en schade). Elke 5e golf bevat een baas. Als iedereen valt, begint dezelfde golf opnieuw.
- **Honger**: je honger loopt terug (zo'n 7,5 minuut van vol naar leeg). Bij 0 verlies je gezondheid. Doden van konijnen (1 vlees), herten (3) en everzwijnen (4, vechten terug) levert vlees op; `R` eet een stuk (+30 honger, +8 gezondheid). Bij 80+ honger doe je 15% meer schade.
- **Kisten**: staan verspreid, herkenbaar aan een lichtzuil. Hoe verder van het startpunt, hoe beter de kans op een zeldzaam zwaard. Ze vullen zich na 10 minuten weer, bomen groeien na 4 minuten terug.
- **Dood**: je respawnt na 8 seconden en verliest de helft van je hout.

Besturing: WASD, Shift rennen, Spatie springen, muis kijken, linkermuisknop slaan/hakken, E kist openen, R eten, 1-9 of scrollwiel item kiezen, Esc pauze. Werkt de muis niet vast, dan kun je slepen om te kijken.

## Beheer
- Data: volume `swordwoods-data` (bestand `db.json`). Maak hier een back-up van. Wachtwoorden zijn gehasht (scrypt).
- Zet er bij internetgebruik een reverse proxy met HTTPS voor (Caddy, Traefik, nginx). WebSockets (`/ws`) moeten doorgelaten worden. Zonder HTTPS gaan wachtwoorden onversleuteld over het netwerk.
- Instellingen via omgevingsvariabelen: `PORT`, `DATA_DIR`, `FIRST_WAVE_DELAY`, `WAVE_GAP`, `HUNGER_RATE`.
- Gezondheidscheck: `/api/health`. Ranglijst: `/api/leaderboard`.
- De positie van spelers wordt door de client bepaald (de server controleert gevechten, loot en honger). Prima onder vrienden, niet bedoeld tegen valsspelers.
