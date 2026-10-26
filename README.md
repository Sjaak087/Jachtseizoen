# Jachtseizoen — Peel en Maas

Een donkere, tactical-styled webapp voor een eigen Jachtseizoen-potje. Geschikt voor GitHub Pages en Firebase Realtime Database.

## Inbegrepen
- Verplichte browserlocatie-toestemming; zonder toestemming blijft de toegang geblokkeerd.
- Potje maken met unieke code en deelnemen met code.
- Tabs: locatiekaart, live chat, spelinstellingen en teambeheer.
- Politie-/Boeven-teams, spelers toewijzen, teamnamen aanpassen.
- Instelbare speeltijd, GPS-update-interval, aantal offline-momenten en offline-duur.
- Kaart met OpenStreetMap-tegels, markers en status.
- Timer, game over en winnaar instellen.

## Firebase instellen
De app gebruikt de Firebase-configuratie die bij het project is aangeleverd en schrijft naar Realtime Database. Zet in Firebase Console de Realtime Database aan en stel passende beveiligingsregels in.

**Belangrijk:** dit is een prototype en de meegeleverde client controleert rollen vooral in de interface. Voor een echte openbare game moet je Firebase Authentication en strikte Realtime Database Security Rules toevoegen. Zonder server-side beveiliging kan een technisch onderlegde gebruiker requests aanpassen, zich voordoen als host of data van een potje lezen/schrijven. Publiceer dit niet met open database-regels.

De API-key in een Firebase webconfig is normaal gesproken een client identifier, geen databasebeveiliging. Bescherm gegevens via Authentication en database rules.

## Publiceren via GitHub Pages
1. Maak een GitHub-repository aan, bijvoorbeeld `jachtseizoen`.
2. Upload `index.html`, `style.css`, `app.js` en `README.md` naar de root.
3. Ga naar **Settings → Pages**.
4. Kies **Deploy from a branch**, branch `main`, map `/ (root)`, en sla op.
5. Open de Pages-URL via HTTPS. Locatie werkt niet op gewone HTTP, behalve localhost.

## Kaartgebied
De kaart centreert op de regio Peel en Maas. OpenStreetMap-kaarttegels tonen wegen en straten; het is geen officiële gemeentelijke GIS-kaart. De cirkel is alleen een visuele regio-indicatie.

## Belangrijke aandachtspunten
- Gebruik de app alleen met expliciete toestemming van deelnemers. Locatie wordt gedeeld met deelnemers aan hetzelfde potje.
- De app gebruikt GPS in de browser; precisie en achtergrondupdates hangen af van toestel, browser en batterij-instellingen.
- Voor privacy en veiligheid is er geen verborgen tracking bedoeld. De offline-status wordt zichtbaar als een deelnemer een offline-moment activeert.
- Test eerst met een besloten groep voordat je het echt gebruikt.


## Locatie bij vergrendeld scherm / standby
De website probeert een GPS-update te sturen zodra de browser een locatie ontvangt. Wanneer de pagina weer actief wordt, de telefoon weer online komt of de browser focus krijgt, vraagt de app meteen een nieuwe locatie op en probeert deze naar Firebase te sturen. Als een locatie-update te lang uitblijft, toont de kaart een waarschuwing dat het apparaat mogelijk uitstaat, in standby staat of geen verbinding heeft.

**Belangrijk:** mobiele browsers kunnen GPS en JavaScript pauzeren zodra het scherm wordt vergrendeld. Een website kan dit niet betrouwbaar voorkomen of garanderen dat updates doorgaan. De waarschuwing is gebaseerd op de tijd van de laatst ontvangen locatie en kan daarom niet met zekerheid vaststellen dat het apparaat uitstaat. Voor gegarandeerdere achtergrondtracking is een native mobiele app nodig.
