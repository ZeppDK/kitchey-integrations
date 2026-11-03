# Kitchey — self-hosting

Kør din egen Kitchey-server med Docker. Serveren kører fra det færdigbyggede image `ghcr.io/zeppdk/kitchey`. Alle premium-funktioner er inkluderet uden abonnement.

## Kom i gang

**Krav:** Docker og Docker Compose.

```bash
mkdir kitchey && cd kitchey
curl -O https://raw.githubusercontent.com/ZeppDK/kitchey-integrations/main/selfhost/docker-compose.yml
curl -O https://raw.githubusercontent.com/ZeppDK/kitchey-integrations/main/selfhost/.env.example
cp .env.example .env    # udfyld DB_PASSWORD, JWT_SECRET og APP_URL
docker compose up -d
curl localhost:3035/api/health
```

Health-endpointet svarer med `ok`, serverens `version`, `selfHosted`, `registrationOpen` og `hasUsers`. Serveren er nu tilgængelig på `http://din-server-ip:3035`.

Mappen hedder `kitchey`, så volumenavnene bliver `kitchey_pgdata` og `kitchey_uploads`. Hedder mappen noget andet, er præfikset mappenavnet i lowercase.

## Første opstart

1. Åbn `http://din-server-ip:3035` i en browser. Der skal ikke bruges app til opsætningen.
2. Opret konto. Den første konto på en tom database bliver ejer.
3. Opret husstand.
4. Hent invitationskoden under Indstillinger → Husstand.

## Inviter familien

- **Invitationskode (anbefalet):** Familien vælger "Opret konto" og indtaster koden. De kommer direkte ind i husstanden.
- **Åben registrering:** Sæt `REGISTRATION_OPEN=true` i `.env` og kør `docker compose up -d`. Sæt den til `false` igen, når alle er oprettet.

## Forbind appen

1. Åbn Kitchey-appen → Indstillinger → Avanceret → **Server-URL**.
2. Indtast serverens adresse, fx `https://kitchey.dit-domain.dk`.
3. Log ind eller opret konto.

> **Obs:** I butiks-appen (App Store / Google Play) kræver feltet Server-URL i dag et aktivt Kitchey-abonnement. Web-UI'et på serveren har ingen begrænsning.

## Home Assistant og Homey

Begge integrationer har et "Server URL"-felt (standard `https://kitchey.aihuset.dk`), som du ændrer til din egen server. Derudover skal de bruge en Personal Access Token (PAT).

1. Opret token: Indstillinger → Avanceret → **API-adgangsnøgler** → angiv navn → **Opret**. Tokenet (`ft_live_…`) vises kun én gang.
2. **Home Assistant:** se [integrationen](../custom_components/kitchey/) og [opsætningen i hovedreadme](../README.md#home-assistant). Indsæt din Server URL og token.
3. **Homey:** se [Homey-appens README](../homey/README.md). Indsæt din Server URL og token.

## Opdatering

Tag en backup først (se nedenfor). Kør derefter:

```bash
docker compose pull
docker compose up -d
```

Databasemigrationer kører automatisk ved opstart. Tjek versionen med `curl localhost:3035/api/health`.

Vil du selv styre hvornår der opdateres, så pin tagget i `docker-compose.yml`, fx `ghcr.io/zeppdk/kitchey:1.2`. Tilgængelige tags er `latest`, `X.Y.Z` og `X.Y`.

## Backup og gendannelse

**Database:**

```bash
docker compose exec -T db pg_dump -U kitcheyuser kitchey > kitchey-$(date +%F).sql
```

**Uploads (produktbilleder):**

```bash
docker run --rm -v kitchey_uploads:/data -v "$PWD":/backup alpine tar czf /backup/uploads.tgz -C /data .
```

**Gendannelse:** Overskriver alle data i volumenerne. Kør den på en ny installation, eller stop serveren og fjern volumenerne først:

```bash
docker compose down
docker volume rm kitchey_pgdata kitchey_uploads
docker compose up -d db
docker compose exec -T db psql -U kitcheyuser -d kitchey < kitchey-DATO.sql
docker run --rm -v kitchey_uploads:/data -v "$PWD":/backup alpine sh -c "tar xzf /backup/uploads.tgz -C /data && chown -R 1000:1000 /data"
docker compose up -d
```

## Reverse proxy og HTTPS (anbefalet)

Eksponer ikke serveren direkte mod internettet. Brug fx [Nginx Proxy Manager](https://nginxproxymanager.com/):

1. Proxy Host → Forward til serverens IP, port `3035`.
2. Slå **Websockets Support** til. Realtid kører på `/ws`, og den kræver Upgrade-headers.
3. Under SSL: anmod om certifikat (Let's Encrypt) og slå **Force SSL** til.
4. Sæt `APP_URL` til den offentlige https-adresse og kør `docker compose up -d`.

Personal Access Tokens er bearer tokens. De må **aldrig** sendes over ukrypteret HTTP.

## Miljøvariabler

| Variabel | Påkrævet | Beskrivelse |
|---|---|---|
| `DB_PASSWORD` | Ja | PostgreSQL-adgangskode. Kun bogstaver og tal. |
| `JWT_SECRET` | Ja | Hemmelig nøgle til JWT-tokens (min. 32 tegn) |
| `APP_URL` | Ja | Serverens offentlige URL (bruges i mails) |
| `PORT` | — | Port på værten (default: 3035) |
| `REGISTRATION_OPEN` | — | `true` = åben registrering (default: `false`) |
| `TZ` | — | Tidszone (default: `Europe/Copenhagen`) |
| `SMTP_HOST` | — | SMTP-server til password-nulstilling |
| `SMTP_PORT` | — | SMTP-port (default: 587) |
| `SMTP_USER` | — | SMTP-brugernavn |
| `SMTP_PASS` | — | SMTP-adgangskode |
| `SMTP_FROM` | — | Afsenderadresse |
| `FIREBASE_SERVICE_ACCOUNT` | — | Firebase service account JSON som én linje (Android-push) |
| `APNS_KEY` | — | APNs-nøgle (iOS-push) |
| `APNS_KEY_ID` | — | APNs key ID |
| `APNS_TEAM_ID` | — | APNs team ID |

Uden SMTP står password-reset-linket i serverlogen. Native push er valgfrit. Uden det sendes udløbsvarsler kun til web.

## Fejlsøgning

- **Logs:** `docker compose logs -f app`
- **Svarer serveren?** `curl localhost:3035/api/health`
- **Fejlen `REGISTRATION_CLOSED`:** Registrering er lukket. Brug en invitationskode, eller sæt `REGISTRATION_OPEN=true` midlertidigt.
- **`Port is already allocated`:** En anden tjeneste bruger porten. Skift `PORT` i `.env` og kør `docker compose up -d`.
- **`DB_PASSWORD mangler i .env` / `JWT_SECRET mangler i .env`:** Udfyld variablen i `.env`.
- **Reset-mail kommer ikke:** Uden SMTP står linket i `docker compose logs app`.

Efter ændringer i `.env` skal du køre `docker compose up -d`. Så genskabes containeren med de nye værdier.

## Licens

Serverimaget er lukket kildekode. Gratis til privat brug. Må ikke redistribueres eller sælges. (endelig ordlyd følger)
