Kitchey holder styr på, hvad der er i køleskab, fryser og skab, hvornår det udløber, og hvad husstanden mangler at købe. Denne app bringer det ind i Homey.

DET FÅR DU

Enheder
- Husstand (overblik): varer på lager, varer der udløber inden 3 og 7 dage, udløbne varer, åbne indkøb, en alarm for udløbne varer, den vare der udløber næste gang, senest tilføjede vare samt navnene på udløbne og snart udløbne varer.
- Opbevaringssted: én enhed pr. køleskab, fryser eller skab med de samme tal og tekster for det sted.
- Indkøbsliste: antal åbne punkter, listen som tekst og én linje pr. åbent punkt.
Alle tal og alarmen logges i Insights og kan sættes på Homey Dashboards.

Flow-triggers
- En vare udløber inden for X dage, udløber i dag eller er udløbet
- En vare blev lagt på lager eller fjernet
- Et indkøb blev tilføjet, afkrydset eller fjernet
- Indkøbslisten er klaret eller vokser til over X punkter

Flow-betingelser
- Et produkt er på lager (med mindste antal)
- En vare står på indkøbslisten
- Der er udløbne varer, eller varer der udløber inden for X dage, i et opbevaringssted eller hele husstanden
- Indkøbslisten har mere end X åbne punkter

Flow-handlinger
- Læg varer på lager (fra kataloget eller efter navn), marker varer som brugt, sæt antal, fjern varer
- Sæt varer på indkøbslisten, afkryds dem, fjern dem, ryd afkrydsede
- Hent indkøbslisten, lagerbeholdningen for et produkt eller varer der snart udløber som tekst-tokens til notifikationer og oplæsning
- Opret katalogprodukter, opbevaringssteder og hylder
De samme handlinger findes også direkte på hvert opbevaringssted og på indkøbslisten.

OPSÆTNING

1. Opret en adgangsnøgle (Personal Access Token) i Kitchey-appen: Indstillinger > Avanceret > API-adgangsnøgler.
2. Åbn appens indstillinger i Homey, indtast server-URL (behold standarden for Kitchey-cloud, eller din egen URL hvis du selv hoster) og nøglen.
3. Tryk "Test forbindelse og hent husstande", vælg din husstand og gem.
4. Tilføj enheder: Enheder > Tilføj > Kitchey.

Data opdateres hvert 5. minut og lige efter hver Flow-handling. Selvhostede Kitchey-servere understøttes.

Kitchey findes til iOS og Android. Læs mere på https://aihuset.dk/kitchey
