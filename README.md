# Jachtseizoen — Nederland

Een donkere, tactical-styled webapp voor een eigen Jachtseizoen-potje. Geschikt voor GitHub Pages en Firebase Realtime Database.

## Inbegrepen
- Verplichte browserlocatie-toestemming; zonder toestemming blijft de toegang geblokkeerd.
- Potje maken met unieke code en deelnemen met code.
- Tabs: locatiekaart, live chat, spelinstellingen en teambeheer.
- Politie-/Boeven-teams, spelers toewijzen, teamnamen aanpassen.
- Instelbare speeltijd, GPS-update-interval, aantal offline-momenten en offline-duur.
- Kaart met OpenStreetMap-tegels van Nederland, markers en status; bij een actief potje zoomt de kaart naar de spelers.
- Wandelroutes over het OpenStreetMap-wandelnetwerk naar tegenstanders, met routeafstand en geschatte wandel- en rentijd.
- De snelste berekende wandelroute naar een tegenstander wordt met de kleur van jouw team op de kaart getoond.
- Verplaatsingslijnen in de teamkleur van de tegenstander tonen een geschat pad over wandelwegen tussen opeenvolgende GPS-updates.
- Timer, game over en winnaar instellen.
- Bovenaan tijdens een live potje een aftellende timer tot de volgende GPS-update.
- Waarschuwing op de kaart alleen wanneer een tegenstander geen recente locatie doorstuurt.
- Home-overzicht van gemaakte/gejoinde potjes; de geschiedenis wordt lokaal in de browser opgeslagen en kan worden gebruikt om potjes opnieuw te openen.

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

## Kaart en routering
De kaart opent met een overzicht van Nederland en zoomt vervolgens naar de spelers wanneer de teamlocaties beschikbaar zijn. Wegen en wandelpaden komen van OpenStreetMap. Wandelroutes worden berekend via de openbare OSRM/FOSSGIS-routeringsservice (`routing.openstreetmap.de`) met het voetgangersprofiel. De app houdt minimaal ongeveer 1,1 seconde tussen routeaanvragen aan om het gebruik van de publieke service te beperken.

Afstand is de berekende routeafstand over het wandelnetwerk, niet de hemelsbrede afstand. Wandel- en rentijden zijn schattingen op basis van respectievelijk 4,8 km/u en 10 km/u; werkelijke snelheid hangt af van de persoon en omstandigheden. De snelste beschikbare wandelroute krijgt de kleur van jouw team. Verplaatsingslijnen van tegenstanders proberen het pad tussen twee GPS-updates via wandelwegen te schatten. Omdat de app alleen de twee gedeelde GPS-punten kent, kan ze niet weten welke weg de speler in werkelijkheid precies heeft genomen. Als de routeringsservice niet beschikbaar is, wordt voor zo'n verplaatsingslijn een gestippelde GPS-verbindingslijn gebruikt en wordt de routeafstand als niet beschikbaar aangegeven.

## Belangrijke aandachtspunten
- Gebruik de app alleen met expliciete toestemming van deelnemers. Locatie wordt gedeeld met deelnemers aan hetzelfde potje. Voor routeberekening worden de coördinaten van vertrek- en eindpunten ook naar de openbare OSRM/FOSSGIS-routeringsservice gestuurd; de beheerder vermeldt dat routeaanvragen in serverlogs worden opgeslagen.
- De app gebruikt GPS in de browser; precisie en achtergrondupdates hangen af van toestel, browser en batterij-instellingen.
- Voor privacy en veiligheid is er geen verborgen tracking bedoeld. De offline-status wordt zichtbaar als een deelnemer een offline-moment activeert.
- Test eerst met een besloten groep voordat je het echt gebruikt.


## Locatie bij vergrendeld scherm / standby
De website probeert een GPS-update te sturen zodra de browser een locatie ontvangt. Wanneer de pagina weer actief wordt, de telefoon weer online komt of de browser focus krijgt, vraagt de app meteen een nieuwe locatie op en probeert deze naar Firebase te sturen. Als de locatie van een tegenstander te lang uitblijft, toont de kaart een waarschuwing dat diens apparaat mogelijk uitstaat, in standby staat of geen verbinding heeft. De waarschuwing wordt niet getoond vanwege een probleem met de eigen locatie.

**Belangrijk:** mobiele browsers kunnen GPS en JavaScript pauzeren zodra het scherm wordt vergrendeld. Een website kan dit niet betrouwbaar voorkomen of garanderen dat updates doorgaan. De waarschuwing is gebaseerd op de tijd van de laatst ontvangen locatie en kan daarom niet met zekerheid vaststellen dat het apparaat uitstaat. Voor gegarandeerdere achtergrondtracking is een native mobiele app nodig.


## Potjesgeschiedenis
De Home-pagina bewaart maximaal 30 potjes die je zelf hebt aangemaakt of gejoint, in de lokale browseropslag. Het overzicht haalt bij het verversen de actuele status uit Firebase op. De geschiedenis is apparaat-/browsergebonden; wissen van browsergegevens kan deze lokale lijst verwijderen.
