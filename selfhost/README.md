# Kitchey — Self-hosting

Kør din egen Kitchey-server med Docker. Alle premium-funktioner er inkluderet uden abonnement.

## Kom i gang

**Krav:** Docker + Docker Compose

```bash
# 1. Download konfigurationsfilerne
curl -O https://raw.githubusercontent.com/ZeppDK/kitchey-integrations/main/selfhost/docker-compose.yml
curl -O https://raw.githubusercontent.com/ZeppDK/kitchey-integrations/main/selfhost/.env.example

# 2. Opret .env og udfyld variablerne
cp .env.example .env
# Rediger .env — skift mindst DB_PASSWORD, JWT_SECRET og APP_URL

# 3. Start serveren
docker compose up -d

# 4. Tjek at den kører
curl http://localhost:3035/api/health
```

Serveren er nu tilgængelig på `http://din-ip:3035`.

## Forbind Kitchey-appen

1. Åbn appen → Indstillinger → Avanceret → **Server-URL**
2. Indtast din servers adresse, f.eks. `https://kitchey.dit-domain.dk`
3. Log ind eller opret en konto — alle premium-funktioner er automatisk aktiveret

> Appen kræver premium for at tillade tilpasning af server-URL. Hvis du bruger den officielle app fra App Store / Google Play, skal du have et aktivt Kitchey-abonnement for at ændre server-adressen.

## Adgangsstyring

**Standard:** Kun den første bruger på en tom database kan registrere sig. Efterfølgende brugere inviteres via en **husstand-kode** fra ejeren (Indstillinger → Husstande → Invitationskode).

Sæt `REGISTRATION_OPEN=true` i `.env` for at åbne for fri registrering.

## Home Assistant

Se [Home Assistant-integrationen](../custom_components/kitchey/) for opsætning med Personal Access Tokens (PAT).

Opret et token: Indstillinger → Avanceret → **Adgangstokens** → Nyt token.

## Opdatering

```bash
docker compose pull
docker compose up -d
```

## Reverse proxy (anbefalet)

Eksponer ikke serveren direkte på port 80/443. Brug en reverse proxy som [Nginx Proxy Manager](https://nginxproxymanager.com/) eller Traefik med HTTPS.

Personal Access Tokens er bearer tokens og må **ikke** sendes over ukrypteret HTTP.

## Miljøvariabler

| Variabel | Påkrævet | Beskrivelse |
|---|---|---|
| `DB_PASSWORD` | ✅ | PostgreSQL-adgangskode |
| `JWT_SECRET` | ✅ | Hemmelig nøgle til JWT-tokens (min. 32 tegn) |
| `APP_URL` | ✅ | Serverens offentlige URL (bruges i emails) |
| `PORT` | — | Eksponeret port (default: 3035) |
| `REGISTRATION_OPEN` | — | `true` = åben registrering (default: `false`) |
| `SMTP_HOST` | — | SMTP-server til password-nulstilling |
| `SMTP_PORT` | — | SMTP-port (default: 587) |
| `SMTP_USER` | — | SMTP-brugernavn |
| `SMTP_PASS` | — | SMTP-adgangskode |
| `SMTP_FROM` | — | Afsendernavn/email |
| `FIREBASE_SERVICE_ACCOUNT` | — | Firebase service account JSON (Android push) |
