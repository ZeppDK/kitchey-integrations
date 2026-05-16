# Plan · Kitchey HA Command Center Panel

## Brief
En custom Home Assistant sidebar-panel der registreres automatisk af Kitchey-integrationen og giver et fuldt "command center" til lager, indkøbsliste, katalog og indstillinger - herunder stregkodelæser-support via USB HID. Panelet erstatter behovet for Kitchey-appen for selfhosted brugere og fungerer som kraftfuldt supplement til app-brugere.

## Stack
- Vanilla JS (ES2020) webcomponent - ingen build-trin, ingen bundler
- Home Assistant `panel_custom` Python API til sidebar-registrering
- Kitchey REST API (samme endpoints som eksisterende integration)
- HA WebSocket API til at hente gemte credentials fra config entry
- `homeassistant/custom_components/kitchey/panel/kitchey-panel.js` - ét fil
- `homeassistant/custom_components/kitchey/__init__.py` - udvides med panel-registrering

## Scope

**Visuals**
- Top navigation: fire tabs (Lager / Indkøbsliste / Katalog / Indstillinger), grøn `#4CAF82` aktiv indikator
- Lager-tab: søgefelt øverst, filterdropdown (alle enheder / specifik enhed / lokation), liste med varekort (navn, antal, udløbsdato-badge, lokation), klik-åbner redigerings-drawer (antal, udløbsdato, lokation dropdown, "Brug X"-knap)
- Indkøbsliste-tab: søgefelt, input-felt + knap til at tilføje vare, liste med varer (navn, antal, enhed), swipe/klik for at markere fundet, slet-ikon
- Katalog-tab: søgefelt, kategori-filter (Køleskab / Fryser / Kolonial), produktkort med navn/mærke/lager-badge, klik åbner "Tilføj til lager"-dialog (antal, udløbsdato, lagerenhed)
- Indstillinger-tab: husstand-sektion (navn, invitationskode, husstand-ID), lagerenheder pr. type (Frysere/Køleskabe/Kolonialskabe) med opret/slet + premium-lock på officiel server, hylder pr. enhed med opret/slet + premium-lock, kostvanepræferencer (6 toggles: Glutenfri, Mælkefri, Laktosefri, Nødefri, Vegetarisk, Vegansk), profil-sektion (email readonly, navn input + gem)
- Scan-overlay: modal der popper op ved stregkode-scan med produktnavn og valgmuligheder (tilføj til lager / tilføj til indkøbsliste / afvis)
- Farvetema: hvid baggrund `#f5f5f7`, kort med `border-radius: 12px`, grøn accent `#4CAF82`, røde badges for udløbet/kritisk, orange for 3-7 dage

**Functionality**
- Panel registreres via `panel_custom.async_register_panel()` i `async_setup_entry` - ingen bruger-YAML
- Credentials (server_url, token, household_id) hentes fra HA config entry via `hass.data`-endpoint eksponeret som `/api/kitchey/config`
- Alle CRUD-operationer kalder Kitchey API direkte fra JS (samme endpoints som Python-koordinatoren)
- Lager: vis alle items, rediger via PUT `/api/inventory/{id}` med body `{quantity, location_id, expiry_date, notes}`, brug item via POST `/api/inventory/{id}/use`
- Indkøbsliste: tilføj (POST `/api/shopping`), tjek af (PUT `/api/shopping/{id}` med `{checked: true}`), slet enkelt (DELETE `/api/shopping/{id}`), ryd alle checkede (DELETE `/api/shopping/checked`)
- Katalog: hent alle produkter (GET `/api/catalog`), opret nyt produkt (POST `/api/catalog`), tilføj katalog-produkt til lager (POST `/api/inventory`)
- Stregkodelæser: global `keydown`-listener, buffer tegn hvis interval < 50ms, ved Enter med buffer >= 8 tegn - kald `GET /api/barcode/{code}` (lokal → community DB → OpenFoodFacts fallback), vis scan-overlay med produktnavn og valgmuligheder
- Indstillinger - husstand: GET `/api/households/{id}`, PATCH `/api/households/{id}` med `{name, icon}`, POST `/api/households/{id}/regenerate-code` til ny invitationskode
- Indstillinger - lagerenheder: GET `/api/storage-units`, POST `/api/storage-units` (premium-gated), DELETE `/api/storage-units/{id}`
- Indstillinger - hylder: GET `/api/locations?storage_unit_id={id}`, POST `/api/locations` (premium-gated), DELETE `/api/locations/{id}`
- Indstillinger - kostvanepræferencer: GET/PUT `/api/preferences` med body `{filters: string[]}` - bruger-niveau (ikke husstand), filters er array af strenge fx `["gluten_free", "dairy_free"]`
- Indstillinger - profil: GET `/api/auth/me`, PATCH `/api/auth/me` med `{display_name}` (email er readonly)
- Premium-gate: kald `/api/premium/status` ved opstart, vis lock-ikon + forklarende besked på opret-knapper hvis `isPremium === false` og server er officiel; cache premium-status i 30 min
- Auto-refresh hvert 5. minut eller efter hver mutation
- Fejl vises inline (rød banner øverst i det relevante afsnit)

## Out of Scope
- Bruger-login / token-generering inde i panelet (credentials antages konfigureret i HA-integrationen)
- Offline-mode / lokal caching ud over hvad browseren giver gratis
- Notifikationer / push-beskeder
- Billed-upload til produkter
- Multi-husstand-skift inde i panelet (ét husstand pr. config entry)
- Kostvanepræferencer gemmes ikke til Kitchey API hvis endpointet ikke eksisterer - UI-only toggle er ikke i scope, vi springer over hvis API mangler
- Mobiloptimering ud over at det ikke er helt ødelagt

## Constraints
- Ét JS-panel-fil (`kitchey-panel.js`) - ingen build, ingen npm, ingen bundler
- Ingen eksterne CDN-afhængigheder i panel-filen (alt inline)
- Panel-registrering må ikke kræve ændringer i brugerens `configuration.yaml`
- Premium-gate må aldrig blokere læse-operationer - kun oprettelse
- Eksisterende Lovelace-kort og Python-koordinator må ikke ændres
- `rejectUnauthorized` følger samme logik som api.js: kun false for ikke-officielle servere
- Stregkodelæser-buffer må ikke forstyrre normal tekstindtastning i inputfelter

## Definition of Done
`kitchey-panel.js` eksisterer i `homeassistant/custom_components/kitchey/panel/`, panelet registreres automatisk i HA's sidebar ved integration-opstart, alle fire tabs loader data fra Kitchey API, lager-redigering gemmer via API, stregkodelæser åbner scan-overlay ved HID-input, og premium-gate vises korrekt på opret-knapper ved officiel server uden premium.

## Acceptance Criteria
- `panel/kitchey-panel.js` findes og er en valid JS webcomponent med `customElements.define('kitchey-panel', ...)`
- `__init__.py` kalder `panel_custom.async_register_panel()` i `async_setup_entry` med sidebar-titel "Kitchey" og ikon `mdi:fridge-outline`
- `/api/kitchey/config` HTTP-endpoint returnerer `{server_url, token, household_id}` kun til autentificerede HA-brugere
- Lager-tab viser items fra `/api/inventory` med søg og enhed-filter
- Klik på lager-item åbner redigerings-drawer med antal, udløbsdato og lokation - gem kalder PUT `/api/inventory/{id}`
- "Brug"-knap i drawer kalder POST `/api/inventory/{id}/use` og opdaterer listen
- Indkøbsliste viser unchecked items, tilføj/tjek/slet virker mod API
- Katalog søger i `/api/catalog` og "Tilføj til lager" åbner dialog med enhed/antal/dato
- Indstillinger viser husstand-info og lagerenheder; opret-knapper viser lock + besked hvis officiel server + ikke premium
- USB stregkodelæser (simuleret med hurtig tastning + Enter i browserkonsol) åbner scan-overlay med produktnavn

## Verification
1. Genstart HA-instansen - verificer at "Kitchey" vises i sidebar uden `configuration.yaml`-ændringer
2. Klik Kitchey i sidebar - verificer at panel loader og Lager-tab viser items
3. Klik et lager-item - verificer at drawer åbner med korrekte felter
4. Rediger antal, gem - verificer i Kitchey-appen at ændringen er synkroniseret
5. Indkøbsliste-tab: tilføj en vare - verificer den dukker op i Kitchey-appen
6. Katalog-tab: søg "mælk" - verificer resultater fra API
7. Indstillinger: verificer husstand-ID matcher det kendte ID
8. Browser-konsol: `window._kitcheyBarcodeSim('5701234567890')` trigger scan-overlay
9. Officiel server + ikke-premium: opret lagerenhed-knap er disabled med lock-ikon

## Turn Budget
Stop efter 70 turns, eller tidligere når DoD-betingelsen holder.

## References
- Eksisterende API-klient: `homeassistant/custom_components/kitchey/coordinator.py`
- Panel-registrering mønster: `homeassistant/custom_components/kitchey/__init__.py`
- Kitchey app screenshots: indstillingssiden med husstand, lagerenheder, kostvanepræferencer, profil
- Eksisterende Lovelace-kort til visuel reference: `homeassistant/custom_components/kitchey/lovelace/`
- Farver og typografi: `#4CAF82` grøn, `#f5f5f7` baggrund, `-apple-system` fontstack

## Confirmed API Details (fra backend-kildekode)
- `PUT /api/inventory/{id}` accepterer: `{quantity, location_id, expiry_date, notes, opened, opened_at}`
- `GET /api/barcode/{code}` eksisterer og kæder: lokal katalog → community DB → OpenFoodFacts; returnerer `{source, product}`
- `GET /PUT /api/preferences` er bruger-niveau (JWT/PAT token), body: `{filters: string[]}` - ikke husstand-niveau
- `PATCH /api/auth/me` accepterer `{display_name, language}` - email kan ikke ændres
- `PATCH /api/households/{id}` accepterer `{name, icon}`
- `POST /api/households/{id}/regenerate-code` regenererer invitationskoden
- `DELETE /api/shopping/checked` rydder alle checkede varer på én gang
- Premium-gate er backend-utils: `checkInventoryLimit`, `checkUnitLocked`, `checkLocationLimit`

## Risks / Open Questions
- `panel_custom.async_register_panel()` API - signaturen har ændret sig mellem HA-versioner; test mod HA 2024.x+
- `/api/kitchey/config`-endpoint eksponerer token til browserens JS - acceptabelt da HA's auth-lag beskytter det, men credentials lever i browser-memory
- Præcise filter-strenge til kostvanepræferencer (`"gluten_free"` vs `"glutenfri"` osv.) skal verificeres mod backend enum-værdier ved implementation
