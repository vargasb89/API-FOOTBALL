# Football Value Lab

Plataforma web para analisis estadistico de apuestas de futbol enfocada en detectar value betting comparando cuotas de casas con datos reales de API-Football.

## Stack

- Next.js App Router
- Node.js en server components
- PostgreSQL para cache persistente y snapshots reutilizables
- Redis para cache rapido
- TailwindCSS para UI

## Variables de entorno

El proyecto usa `.env` y nunca hardcodea la API key.

Variables soportadas:

- `API_FOOTBALL_KEY` obligatoria
- `API_FOOTBALL_BASE_URL` opcional, por defecto `https://v3.football.api-sports.io`
- `DATABASE_URL` opcional para cache persistente PostgreSQL
- `REDIS_URL` opcional para cache Redis
- `MAIN_LEAGUE_IDS` opcional, lista separada por comas
- `DEFAULT_SEASON` opcional

## Instalacion

```bash
npm install
npm run dev
```

Abrir [http://localhost:3000](http://localhost:3000).

## Base de datos

Ejecuta el esquema SQL inicial en PostgreSQL:

```bash
psql "$DATABASE_URL" -f db/schema.sql
```

Tablas incluidas:

- `api_cache`: respuestas cacheadas para reducir llamadas repetidas
- `market_snapshots`: base para guardar mercados y evolucion historica

## Cache y rate limiting

- Cache en memoria de 60 segundos minimo
- Reuso de Redis cuando `REDIS_URL` existe
- Reuso de PostgreSQL cuando `DATABASE_URL` existe
- Manejo de `429` con espera usando `retry-after`
- Pausa ligera si el header de rate limit reporta saldo muy bajo

## Modulos principales

- `/`: dashboard con partidos del dia, ligas principales y oportunidades potenciales
- `/matches`: explorador filtrable por fecha, liga, pais y temporada
- `/matches/[fixtureId]`: detalle de partido con mercados, tabla y bookmakers
- `/teams/[teamId]`: estadisticas de temporada y split local/visitante
- `/calculator`: calculadora de value betting

## Estructura

```text
src/
  app/
  components/
  lib/
db/
  schema.sql
```

## Notas

- El cliente API-Football solo hace peticiones `GET`
- La autenticacion usa el header `x-apisports-key`
- Si no configuras PostgreSQL o Redis, la app sigue funcionando con cache en memoria
- La pagina de detalle ya filtra mercados foco: 1X2, double chance, over/under, BTTS, team totals y asiaticos basicos
