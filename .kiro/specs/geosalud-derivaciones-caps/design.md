# Design Document — GeoSalud: Derivaciones a CAPS (Prototipo estático)

## Overview

GeoSalud es un **prototipo demostrable** que se entrega como una página HTML auto-contenida con dos vistas (Analytics_View y Referral_View) seleccionables por tabs y filtrables por rol:

- **Analytics_View**: tablero analítico con mapa Leaflet, marcadores de CAPS, capa de zonas de baja cobertura e indicadores agregados.
- **Referral_View**: flujo operativo que recibe ubicación del paciente y patología, y devuelve un ranking de CAPS recomendados.

Todo corre **100% en el navegador**: no hay backend propio, ni base de datos, ni servicios cloud. La aplicación se sirve como Static_Bundle (HTML + JS + CSS + JSON) sobre cualquier hosting estático y funciona también desde `file://` cuando el navegador lo permite.

El dataset REFES se obtiene **una sola vez, offline**, mediante el MCP local `mcp-datos-abiertos-arg`, se normaliza con la API Georef de Argentina y se persiste como `data/refes.json` dentro del Static_Bundle. La población INDEC, el catálogo de patologías y la capacidad operativa se proveen como datasets estáticos JSON. La capacidad operativa se accede a través de una interfaz JavaScript abstracta (`Capacity_Provider`) con dos implementaciones: `Mock_Capacity_Provider` (default) y `Future_API_Capacity_Provider` (stub).

`localStorage` se usa exclusivamente para favoritos (`geosalud:favorites`) e historial de derivaciones simuladas (`geosalud:referralHistory`), nunca para datos del paciente.

## Architecture

### Diagrama lógico

```
══════════════════════════ FLUJO OFFLINE (una vez, antes de la demo) ══════════════════════════

  ┌─────────────────────────┐    invoca tools     ┌──────────────────────────┐
  │ scripts/                │ ──────────────────▶ │ mcp-datos-abiertos-arg   │
  │  fetch_refes_via_mcp.py │                     │ (servidor MCP local)     │
  │                         │ ◀────metadata────── │  search_datasets         │
  │  - filtra CAPS          │                     │  get_dataset_info        │
  │  - filtra regionCode    │                     │  list_dataset_resources  │
  │  - valida coords        │                     │  query_resource_data     │
  │  - normaliza (Georef)   │                     └──────────┬───────────────┘
  └────────────┬────────────┘                                │
               │                                              │ HTTPS
               │                                              ▼
               │                                   ┌──────────────────────┐
               │                                   │ datos.gob.ar (CKAN)  │
               │                                   │ + Georef API         │
               │                                   └──────────────────────┘
               │
               ▼
  ┌─────────────────────────┐
  │ prototype/data/         │
  │  refes.json             │   ← REFES_Static_File (regenerable)
  │  population_mock.json   │
  │  pathology_catalog.json │
  │  capacity_mock.json     │
  └─────────────────────────┘

══════════════════════════ FLUJO RUNTIME (navegador del usuario) ══════════════════════════

  ┌────────────────────────────────────────────────────────────────────────┐
  │ Browser (Chrome / Firefox / Edge)                                       │
  │                                                                         │
  │   ┌────────────┐   ┌──────────────┐   ┌──────────────┐                │
  │   │ index.html │──▶│ app.js       │──▶│ ui/          │                │
  │   │ tabs       │   │ bootstrap    │   │  AnalyticsView│                │
  │   │ Leaflet    │   │ App_Config   │   │  ReferralView │                │
  │   └────────────┘   └──────┬───────┘   │  MapCanvas    │                │
  │                           │           └───────┬───────┘                │
  │                           │                   │                         │
  │   ┌───────────────────────▼───────────────────▼───────────────────┐   │
  │   │ Domain modules                                                 │   │
  │   │  refes_loader · referral_engine · coverage_calculator          │   │
  │   │  capacity_provider (Strategy: Mock | FutureApi)                │   │
  │   │  pii_validator · log_scrubber · persistence                    │   │
  │   └───────┬─────────────────────────────────────────────┬──────────┘   │
  │           │                                             │              │
  │     fetch local                                   fetch HTTPS          │
  │           │                                             │              │
  │           ▼                                             ▼              │
  │   ┌──────────────┐                            ┌──────────────────┐    │
  │   │ data/*.json  │                            │ Georef API       │    │
  │   │ (Static_     │                            │ apis.datos.gob.ar│    │
  │   │  Bundle)     │                            │ /georef/api      │    │
  │   └──────────────┘                            └──────────────────┘    │
  │                                                                         │
  │   ┌──────────────────────────────────────────┐                         │
  │   │ window.localStorage                       │                         │
  │   │  geosalud:favorites                       │   ← sólo IDs y meta    │
  │   │  geosalud:referralHistory                 │   ← sin PII            │
  │   └──────────────────────────────────────────┘                         │
  └────────────────────────────────────────────────────────────────────────┘
```

### Decisiones arquitectónicas clave

- **Cliente único (browser-only)**: simplicidad de demo, costo cero de hosting, alineado con el alcance "prototipo demostrable". No hay infraestructura que mantener.
- **Static_Bundle versionado**: `prototype/` se sirve tal cual. Cualquier servidor estático (`python -m http.server`, `npx serve`, GitHub Pages, S3+CloudFront a futuro) funciona.
- **Dataset REFES materializado offline**: el script Python `scripts/fetch_refes_via_mcp.py` invoca al MCP y produce `data/refes.json`. La página runtime no depende de internet para los CAPS — sólo Georef cuando el operador ingresa una dirección textual.
- **Strategy para Capacity_Provider**: contrato único, dos implementaciones intercambiables por `App_Config.capacityProvider`. Permite migrar a una API real sin tocar el resto.
- **PII fuera del sistema**: el navegador no envía PII a ninguna parte (Georef recibe sólo dirección textual sin nombre/dni). Validador y scrubber son client-side, lo único disponible.
- **Sin AWS, sin BD, sin IaC**: alineado con el alcance del prototipo. Los principios de seguridad (HTTPS para todo lo externo, no logear PII, mínimo privilegio en cuanto a capacidades del navegador) siguen aplicando.

### Stack concreto

| Capa | Elección | Justificación |
|---|---|---|
| Lenguaje cliente | **JavaScript ES2020+ con anotaciones JSDoc** (TypeScript strict opcional) | Mantiene el bundle simple. JSDoc da tipado en VS Code sin paso de build obligatorio. Si el equipo prefiere TS, se compila a JS con Vite y se sirve el `dist/` como Static_Bundle. |
| Framework UI | **Vanilla DOM + módulos ES** (sin framework pesado obligatorio) | El alcance es 2 vistas y un panel. Un framework pesado agregaría tiempo de build sin valor. **Si el equipo elige React**, debe empaquetarse con **Vite** en un único bundle estático (`vite build` → `dist/`), conservando la salida en `prototype/` y sin dependencias de servidor dinámico. |
| Mapa | **Leaflet 1.9.x** (CDN o `vendor/leaflet/`) | Requerido por la spec, liviano, sin dependencia de tiles propios (usa OpenStreetMap). |
| Estilos | CSS moderno (Custom Properties + Grid/Flex) | Cero build necesario. Tailwind opcional si se decide usar Vite. |
| Tests JS | **Vitest** + **fast-check** | Vitest corre en Node con jsdom, soporta TS y JSDoc, integra fast-check para property-based testing. |
| Tests Python (script) | **pytest** + **pytest-asyncio** | Alineado con el steering de testing. Mockea las tools del MCP. |
| Linter / formato | ESLint + Prettier (JS/TS), Ruff + Black (Python) | Coherente con `coding-standards`. |

**Decisión recomendada**: arrancar con **HTML + JS módulos ES + JSDoc**. Migrar a TS+Vite sólo si el código supera ~1500 LOC o si el equipo decide usar React.

### Estructura de directorios

```
geosalud-derivaciones-caps/
├── README.md
├── package.json                       # scripts npm para tests, lint, dev server
├── vite.config.ts                     # opcional, sólo si se usa TS o React
│
├── prototype/                         # Static_Bundle servido tal cual
│   ├── index.html                     # entrada única, declara App_Config y carga app.js
│   ├── app.js                         # bootstrap: monta tabs, instancia módulos
│   ├── styles.css
│   ├── config.js                      # App_Config (objeto JS exportado)
│   │
│   ├── modules/                       # módulos ES de dominio
│   │   ├── refes_loader.js
│   │   ├── referral_engine.js
│   │   ├── coverage_calculator.js
│   │   ├── capacity_provider.js       # interface + factory
│   │   ├── capacity_mock.js
│   │   ├── capacity_future_api.js
│   │   ├── pathology_catalog.js
│   │   ├── georef_client.js
│   │   ├── haversine.js
│   │   ├── pii_validator.js
│   │   ├── log_scrubber.js
│   │   └── persistence.js             # wrappers de localStorage
│   │
│   ├── ui/                            # componentes de UI
│   │   ├── analytics_view.js
│   │   ├── referral_view.js
│   │   ├── map_canvas.js
│   │   ├── ranking_list.js
│   │   ├── coverage_panel.js
│   │   └── tabs.js
│   │
│   ├── data/                          # datasets estáticos del bundle
│   │   ├── refes.json                 # generado por scripts/fetch_refes_via_mcp.py
│   │   ├── population_mock.json
│   │   ├── pathology_catalog.json
│   │   └── capacity_mock.json
│   │
│   └── vendor/                        # opcional si no se usa CDN
│       └── leaflet/
│
├── scripts/
│   └── fetch_refes_via_mcp.py         # genera prototype/data/refes.json
│
├── tests/
│   ├── js/
│   │   ├── haversine.test.js
│   │   ├── coverage_calculator.test.js
│   │   ├── referral_engine.test.js
│   │   ├── pii_validator.test.js
│   │   ├── log_scrubber.test.js
│   │   ├── persistence.test.js
│   │   ├── capacity_mock.test.js
│   │   ├── refes_loader.test.js
│   │   └── helpers/
│   │       └── arbitraries.js         # generators fast-check
│   └── python/
│       └── test_fetch_refes_via_mcp.py
│
├── .eslintrc.cjs
├── .prettierrc
├── pyproject.toml                     # ruff/black para scripts/
└── .gitignore
```

## Components and Interfaces

### Cliente — Módulos JS

Notas:
- Todas las firmas son `JSDoc` (vale como TS si se compila con `tsc --allowJs`).
- Cada módulo es una unidad testeable: funciones puras donde sea posible; los efectos (fetch, DOM, localStorage) viven en wrappers delgados.

#### `bootstrap` (en `app.js`)

Responsable de:

1. Cargar `App_Config` desde `config.js`.
2. Aplicar overrides desde `window.location.search` (query params).
3. Validar la config (ver requisito 10.4) — falla con mensaje visible si faltan claves obligatorias.
4. Instanciar `Capacity_Provider` vía factory según `App_Config.capacityProvider`.
5. Llamar `refes_loader.load(App_Config)` y exponer el resultado en `app.state.caps`.
6. Montar `tabs` con visibilidad según rol (`App_Config.role`, `App_Config.roleTabsEnabled`).
7. Renderizar la vista activa.

```js
/**
 * @param {AppConfig} userConfig
 * @returns {Promise<void>}
 */
export async function bootstrap(userConfig) { /* ... */ }
```

#### `refes_loader`

```js
/**
 * @param {AppConfig} cfg
 * @returns {Promise<{caps: CapsRecord[], errors: string[]}>}
 */
export async function loadRefes(cfg) { /* fetch + validate + filter */ }
```

Reglas:

- `fetch(cfg.refesStaticPath)` con `cache: 'default'`.
- Parsea JSON, valida cada registro contra el schema (ver "Data Models").
- Descarta registros con `coordinates.lat ∉ [-90, 90]` o `coordinates.lon ∉ [-180, 180]`, o con campos requeridos faltantes.
- Nunca escribe el dataset a `localStorage`. Lo retorna en memoria.
- En error de red o JSON malformado: lanza `RefesLoadError` con código `network_error` o `parse_error`. El UI capa lo traduce a un mensaje legible y `console.error` recibe sólo el código y el `request_id`.

#### `referral_engine`

```js
/**
 * @param {ReferralRequest} request   // ya sin PII
 * @param {CapsRecord[]} caps
 * @param {PathologyEntry} pathology
 * @param {CapacityProvider} capacityProvider
 * @param {ReferralConfig} config
 * @returns {RankedCap[]}              // longitud <= config.referralMaxResults
 */
export function rank(request, caps, pathology, capacityProvider, config) { /* ... */ }
```

Pipeline:

1. Filtrar `caps` por `region_code ∈ config.regionCodes` (admite lista por requisito 10.5).
2. Filtrar por compatibilidad de prestación: `caps.services ⊇ pathology.required_services` (al menos una en común).
3. Calcular `haversine(request.location, caps.coordinates)` para cada candidato.
4. Pedir `capacityProvider.getCapacity(caps_id)` por cada uno.
5. Calcular score con pesos `config.rankingWeights` (ver "Algorithms").
6. Ordenar descendente por score y truncar a `config.referralMaxResults`.

#### `coverage_calculator`

```js
/**
 * @param {GeoUnit} unit
 * @param {number} capsCount
 * @param {number | null} population
 * @param {number} threshold
 * @returns {CoverageResult}
 */
export function computeUnit(unit, capsCount, population, threshold) { /* ... */ }

/**
 * @param {CoverageResult[]} units
 * @returns {RegionalAggregates}
 */
export function aggregate(units) { /* ... */ }
```

Reglas:

- Si `population != null && capsCount > 0`: `indicator = population / capsCount`, `status = "ok"`.
- Si no: `indicator = null`, `status = "unknown_population"`.
- `low_coverage = (indicator != null) && (indicator >= threshold)`.

#### `capacity_provider` (interfaz + factory)

```js
/**
 * @typedef {Object} CapacityProvider
 * @property {"mock"|"future_api"} name
 * @property {(capsId: string) => CapacitySnapshot} getCapacity
 * @property {(capsId: string) => SuppliesSnapshot} getSupplies
 * @property {(capsId: string) => WaitingTimeSnapshot} getWaitingTime
 */

/**
 * @param {AppConfig} cfg
 * @param {object} [data]                 // capacity_mock.json ya cargado
 * @returns {CapacityProvider}
 * @throws {ConfigError} si capacityProvider tiene un valor no soportado (req 7.6)
 */
export function createCapacityProvider(cfg, data) { /* ... */ }
```

`Mock_Capacity_Provider` (`capacity_mock.js`):
- Recibe el objeto JS embebido o el JSON cargado desde `cfg.capacityMockPath`.
- `getCapacity(id)` busca por `caps_id`. Si no existe, devuelve `{ availability: "unknown", capacitySource: "mock", ... }` (req 7.7).
- Siempre marca `capacitySource: "mock"` (req 7.5).

`Future_API_Capacity_Provider` (`capacity_future_api.js`):
- Implementa la misma firma.
- Devuelve `{ availability: "not_implemented", capacitySource: "future_api", ... }` para todas las operaciones, sin lanzar (req 7.8).

#### `pii_validator`

```js
/** Lista de claves prohibidas en el formulario de Referral_View. */
export const FORBIDDEN_KEYS = Object.freeze([
  "name", "fullName", "firstName", "lastName",
  "dni", "documento", "document", "documentNumber",
  "phone", "telefono", "email", "mail",
  "address", "direccionExacta", "addressLine",
  "obraSocial", "historiaClinica", "medicalRecord",
]);

/** Patrones PII en valores string. */
export const PII_PATTERNS = Object.freeze({
  dniArg: /\b\d{7,8}\b/,
  phone: /\+?\d[\d\s().-]{6,}\d/,
  email: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/,
});

/**
 * @param {Record<string, unknown>} formInput
 * @returns {{ ok: true } | { ok: false, code: "pii_not_allowed", reason: string }}
 */
export function validate(formInput) { /* ... */ }
```

`validate` rechaza el input si:
- Contiene cualquier clave de `FORBIDDEN_KEYS`.
- Cualquier valor string matchea alguno de `PII_PATTERNS`.

Devuelve `{ ok: false, code: "pii_not_allowed", reason }`. El `reason` es agnóstico al contenido (no incluye el valor offensivo).

#### `log_scrubber`

```js
/**
 * @param {string} message
 * @param {Record<string, unknown>} [extra]
 * @returns {{ message: string, extra: Record<string, unknown> }}
 */
export function scrub(message, extra) { /* ... */ }
```

- Reemplaza coincidencias de los `PII_PATTERNS` por marcadores: `<dni>`, `<phone>`, `<email>`.
- Trunca cualquier valor de `extra` cuya clave aparezca en `FORBIDDEN_KEYS` (lo reemplaza por `"<redacted>"`).
- Es idempotente: `scrub(scrub(x)) == scrub(x)`.

Wrapper `safeLog`:

```js
export const log = {
  info:  (msg, extra) => console.info (...Object.values(scrub(msg, extra))),
  warn:  (msg, extra) => console.warn (...Object.values(scrub(msg, extra))),
  error: (msg, extra) => console.error(...Object.values(scrub(msg, extra))),
};
```

Convención: ningún módulo llama directo a `console.*`; todos pasan por `log`.

#### `persistence` (wrappers de localStorage)

```js
const KEYS = Object.freeze({
  favorites: "geosalud:favorites",
  referralHistory: "geosalud:referralHistory",
});

const SCHEMA_VERSION = 1;

/**
 * @returns {string[]}                  // arreglo de caps_id
 */
export function readFavorites() { /* ... */ }

/**
 * @param {string[]} ids
 */
export function writeFavorites(ids) { /* ... */ }

/**
 * @param {string} capsId
 */
export function toggleFavorite(capsId) { /* ... */ }

/**
 * @returns {ReferralHistoryEntry[]}
 */
export function readHistory() { /* ... */ }

/**
 * @param {ReferralHistoryEntry} entry  // sin PII (validado antes de llamar)
 */
export function appendHistory(entry) { /* ... */ }

export function clearAll() { /* ... */ }
```

Reglas:
- Cada valor escrito tiene la forma `{ schemaVersion, payload, updatedAt }`. Si al leer encuentra una `schemaVersion` distinta, devuelve un default vacío y reescribe.
- Tope de tamaño: `MAX_HISTORY_ENTRIES = 50`. Al exceder, rota descartando las más antiguas (FIFO).
- Tope de tamaño total por clave: `MAX_BYTES_PER_KEY = 64 * 1024` (64 KB). `JSON.stringify(entry).length` se valida antes de escribir; si excede, rechaza con `QuotaError`.
- Antes de cada `appendHistory`, valida que la entrada NO contenga claves PII (defensa en profundidad sobre `pii_validator`).

#### `ui` (componentes)

Cada componente es una función que recibe el estado y un `HTMLElement` raíz, y monta/actualiza el DOM. No hay framework; el patrón es "render(props) → mutate DOM".

- `tabs.js`: alterna entre `analytics_view` y `referral_view`. Aplica visibilidad por rol y `roleTabsEnabled` (req 8.3).
- `map_canvas.js`: wrapper de Leaflet. Expone `addCapsMarkers(caps)`, `highlightLowCoverage(units)`, `setPatientMarker(coord)`, `setRanking(ranking)`.
- `analytics_view.js`: monta `map_canvas`, `coverage_panel`, lista de favoritos.
- `referral_view.js`: formulario + `ranking_list`. Limpia su estado al desmontarse (req 9.6).
- `coverage_panel.js`: muestra agregados regionales (req 5.4).
- `ranking_list.js`: lista ordenada con etiqueta "datos simulados" cuando `capacity.capacitySource === "mock"` (req 5.5).

### Script offline — `scripts/fetch_refes_via_mcp.py`

Encapsula el REFES_Acquisition_Procedure (req 2). Usa el MCP `mcp-datos-abiertos-arg` ya presente en el repo y la API Georef.

#### Procedimiento (paso a paso)

1. **Arrancar el MCP localmente**:
   ```bash
   cd mcp-datos-abiertos-arg
   python build_index.py            # genera index.json (una vez)
   ```
   El script `fetch_refes_via_mcp.py` puede:
   - Importar `main` directamente como módulo Python (`from main import tool_search_datasets, ...`), opción más simple para uso offline.
   - O invocar el MCP como subproceso vía stdio (para reproducir el flujo "como lo usaría un agente IA").

2. **Localizar el dataset**:
   ```python
   results = await tool_search_datasets(query="REFES establecimientos salud", limit=10)
   ```
   Filtrar el resultado por título/entidad ("Ministerio de Salud") y elegir el `dataset_id` apropiado.

3. **Obtener metadata y recursos**:
   ```python
   info = await tool_get_dataset_info(dataset_id=...)
   resources = await tool_list_dataset_resources(dataset_id=...)
   ```
   Identificar el recurso CSV/XLSX con los registros de establecimientos.

4. **Descargar y previsualizar**:
   ```python
   preview = await tool_query_resource_data(resource_url=..., rows=20)
   ```
   Usar la preview para confirmar las columnas (`tipologia`, `provincia`, `latitud`, `longitud`, etc.).

5. **Descarga completa**: si el recurso es accesible directo por URL, `httpx.get(resource_url)`; si excede el límite del MCP (20 MB), descargar el CSV original.

6. **Filtrado y normalización en Python**:
   - Filtrar `tipologia ∈ {CAPS}` (acepta variantes comunes — ver `CAPS_TIPOLOGIA_VALUES` en el script).
   - Filtrar por `regionCode` configurable (CLI `--region 06`).
   - Validar coordenadas: descartar fuera de `[-90, 90] × [-180, 180]` o nulas.
   - Para cada registro válido, llamar a Georef:
     ```
     GET https://apis.datos.gob.ar/georef/api/ubicacion?lat={lat}&lon={lon}
     ```
     y enriquecer con IDs y nombres canónicos de provincia/departamento/municipio/localidad.
   - Cachear respuestas Georef en un `geo_cache.json` local para evitar refetch.

7. **Export**: escribir `prototype/data/refes.json` con la estructura definida en "Data Models". Incluir un campo top-level `meta`:
   ```json
   {
     "meta": {
       "schema_version": 1,
       "source": "datos.gob.ar",
       "dataset_id": "...",
       "generated_at": "2026-05-10T12:00:00Z",
       "region_codes": ["06"],
       "record_count": 145
     },
     "items": [ /* CapsRecord[] */ ]
   }
   ```

#### CLI del script

```bash
uvx python scripts/fetch_refes_via_mcp.py \
  --region 06 \
  --output prototype/data/refes.json \
  --georef-cache .cache/geo_cache.json
```

El script imprime resumen al final: registros descargados, descartados por tipología, descartados por coordenadas, faltantes en Georef.

## Data Models

Definidos como interfaces TypeScript (válidas también como `@typedef` JSDoc). Un mismo schema se usa en JS runtime y en el script Python (via `pydantic` o `dataclasses`).

```ts
// prototype/modules/types.ts (o JSDoc en cada módulo)

export interface Coordinates {
  lat: number;     // [-90, 90]
  lon: number;     // [-180, 180]
}

export interface AdminNormalized {
  province_id: string;
  province_name: string;
  department_id?: string;
  department_name?: string;
  municipality_id?: string;
  municipality_name?: string;
  locality_id?: string;
  locality_name?: string;
}

export interface CapsRecord {
  caps_id: string;                    // opaco; derivado del id REFES
  name: string;
  address_normalized: string;
  coordinates: Coordinates;
  admin: AdminNormalized;
  services: string[];                 // catálogo de prestaciones declaradas
  region_code: string;
  source_version: string;             // version del REFES (meta.generated_at)
}

export interface PathologyEntry {
  code: string;                       // p.ej. "RESP_AGUDA"
  label: string;
  required_services: string[];        // prestaciones necesarias
}

export type Availability =
  | "high" | "medium" | "low"
  | "unknown" | "not_implemented";

export interface CapacitySnapshot {
  caps_id: string;
  availability: Availability;
  waiting_time_minutes: number | null;
  supplies_status: "ok" | "low" | "missing" | "unknown";
  capacitySource: "mock" | "future_api";
  captured_at: string;                // ISO 8601
}

export interface SuppliesSnapshot { /* idéntico patrón */ }
export interface WaitingTimeSnapshot { /* idéntico patrón */ }

export interface ReferralRequest {
  request_id: string;                 // ULID/UUIDv4 generado por crypto.randomUUID()
  location: Coordinates;              // ya geocodeada
  pathology_code: string;
  region_codes: string[];
}

export interface RankedCap {
  caps: CapsRecord;
  distance_km: number;
  capacity: CapacitySnapshot;
  compatible_services: string[];
  score: number;                      // [0, 1]
}

export type CoverageStatus = "ok" | "unknown_population";

export interface CoverageResult {
  unit_id: string;
  unit_kind: "province" | "department" | "municipality" | "locality";
  caps_count: number;
  population: number | null;
  indicator: number | null;
  status: CoverageStatus;
  low_coverage: boolean;
}

export interface RegionalAggregates {
  caps_total: number;
  population_total: number;
  coverage_indicator_avg: number | null;
  low_coverage_zones: number;
}

export interface RankingWeights {
  distance: number;                   // >= 0
  capacity: number;                   // >= 0
  services: number;                   // >= 0
  // suma > 0; el cargador normaliza para que sume 1
}

export interface AppConfig {
  regionCode: string | string[];
  refesStaticPath: string;
  pathologyCatalogPath: string;
  capacityProvider: "mock" | "future_api";
  capacityMockPath: string;
  populationMockPath: string;
  lowCoverageThreshold: number;
  rankingWeights: RankingWeights;
  referralMaxResults: number;
  roleTabsEnabled: boolean;
  role?: "ministry" | "operator";
  georefApiBaseUrl: string;           // siempre HTTPS
}

export interface ReferralHistoryEntry {
  request_id: string;                 // opaco
  pathology_code: string;
  region_codes: string[];
  distance_km: number;                // del primer ranking
  ranked_caps_ids: string[];
  timestamp: string;                  // ISO
  schemaVersion: 1;
}
```

### Esquema en disco

`prototype/data/refes.json` (envoltorio + items)
- `meta` describe el origen y la versión.
- `items: CapsRecord[]`.

`prototype/data/population_mock.json`
```json
{
  "meta": { "schema_version": 1, "source": "INDEC mock" },
  "units": [
    { "unit_id": "06028", "unit_kind": "department", "name": "Vicente López", "population": 269420 }
  ]
}
```

`prototype/data/pathology_catalog.json`
```json
{
  "meta": { "schema_version": 1 },
  "items": [
    { "code": "RESP_AGUDA", "label": "Afección respiratoria aguda", "required_services": ["clinica_general"] }
  ]
}
```

`prototype/data/capacity_mock.json`
```json
{
  "meta": { "schema_version": 1 },
  "items": [
    { "caps_id": "REFES-12345", "availability": "medium", "waiting_time_minutes": 35, "supplies_status": "ok", "captured_at": "2026-05-10T12:00:00Z" }
  ]
}
```

### `localStorage`

Claves y formato (req 6.11, 5.6, 9.4):

`geosalud:favorites`
```json
{
  "schemaVersion": 1,
  "payload": ["REFES-12345", "REFES-67890"],
  "updatedAt": "2026-05-10T12:00:00Z"
}
```

`geosalud:referralHistory`
```json
{
  "schemaVersion": 1,
  "payload": [
    {
      "request_id": "01HXY...",
      "pathology_code": "RESP_AGUDA",
      "region_codes": ["06"],
      "distance_km": 1.42,
      "ranked_caps_ids": ["REFES-12345", "REFES-67890"],
      "timestamp": "2026-05-10T12:01:00Z",
      "schemaVersion": 1
    }
  ],
  "updatedAt": "2026-05-10T12:01:00Z"
}
```

Reglas:
- Tope: 50 entradas en `referralHistory`, FIFO al exceder.
- Tope: 64 KB por clave; si una escritura excede, `persistence` rechaza con `QuotaError` y el UI muestra mensaje neutral.
- Migración por versión: lectura con `schemaVersion` distinta → tratar como dato corrupto, devolver default vacío, reescribir.

## End-to-end Flow — Derivación

```
Operador (Referral_View)
  └─ ingresa ubicación (lat/lon o dirección textual) + pathology_code
  └─ pii_validator.validate(formInput)         ──❌→ UI: mensaje "pii_not_allowed", abortar
  └─ buildReferralRequest(formInput)
        ├─ extrae sólo { location, pathology_code }
        ├─ genera request_id = crypto.randomUUID()
        └─ retorna ReferralRequest
  └─ if (location.kind === "address"):
        coords = await georef_client.geocode(location.address)
        if (!coords) → UI: "invalid_location", abortar
  └─ pathology = pathology_catalog.get(pathology_code)
        if (!pathology) → UI: "unknown_pathology", abortar (no invocar engine)
  └─ ranking = referral_engine.rank(request, app.state.caps, pathology, capacityProvider, config)
        if (ranking.length === 0) → UI: "no_caps_available" + lista vacía
  └─ map_canvas.setPatientMarker(coords)
  └─ map_canvas.setRanking(ranking)
  └─ ranking_list.render(ranking)
  └─ persistence.appendHistory({
        request_id, pathology_code, region_codes, distance_km: ranking[0]?.distance_km,
        ranked_caps_ids: ranking.map(r => r.caps.caps_id), timestamp, schemaVersion: 1
     })
```

Cada `log.info/warn/error` pasa por `scrub`. El `request_id` es opaco y nunca se deriva del formInput.

## Algorithms

### Haversine (en `haversine.js`)

```js
const EARTH_RADIUS_KM = 6371.0088;

/**
 * @param {Coordinates} a
 * @param {Coordinates} b
 * @returns {number} distancia en km, en [0, π · R]
 */
export function haversine(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const phi1 = toRad(a.lat);
  const phi2 = toRad(b.lat);
  const dPhi = toRad(b.lat - a.lat);
  const dLambda = toRad(b.lon - a.lon);
  const h = Math.sin(dPhi / 2) ** 2
          + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}
```

Propiedades verificadas en property tests:
- Identidad: `haversine(p, p) === 0`.
- Simetría: `haversine(a, b) === haversine(b, a)` (módulo precisión float).
- Rango: `0 ≤ haversine(a, b) ≤ π · R`.
- Triangular suave (no estrictamente probada por costo, pero queda documentada).

### Coverage Indicator

```
coverage_indicator(unit) =
    population / caps_count   si (population != null) ∧ (caps_count > 0)
    null                      en otro caso  (status = "unknown_population")

low_coverage(unit) = (indicator != null) ∧ (indicator >= threshold)
```

### Ranking score

`App_Config.rankingWeights` ejemplo: `{ "distance": 0.5, "capacity": 0.3, "services": 0.2 }`. El cargador normaliza para que la suma sea 1.0; rechaza si algún peso es negativo o si la suma es 0.

```js
const AVAILABILITY_TO_SCORE = Object.freeze({
  high: 1.0, medium: 0.6, low: 0.2,
  unknown: 0.4, not_implemented: 0.0,
});

/**
 * @param {number} distanceKm
 * @param {CapacitySnapshot} cap
 * @param {number} servicesMatchRatio   // |compatibles| / |requeridas| ∈ [0, 1]
 * @param {RankingWeights} w            // ya normalizados
 * @param {number} maxDistanceKm        // referencia para normalizar distancia
 * @returns {number} score ∈ [0, 1]
 */
export function score(distanceKm, cap, servicesMatchRatio, w, maxDistanceKm) {
  const distanceTerm = Math.max(0, 1 - distanceKm / maxDistanceKm);
  const capacityTerm = AVAILABILITY_TO_SCORE[cap.availability] ?? 0;
  const servicesTerm = servicesMatchRatio;
  return w.distance * distanceTerm
       + w.capacity * capacityTerm
       + w.services * servicesTerm;
}
```

Propiedades:
- `score ∈ [0, 1]` para todo input válido.
- Monotonía en distancia: a igualdad del resto, distancia menor → score mayor o igual.
- Ranking ordenado desc por score, longitud ≤ `referralMaxResults`.

## PII Handling Strategy (cliente-side)

1. **Validador de input** (`pii_validator`):
   - Lista negra de claves prohibidas (`FORBIDDEN_KEYS`).
   - Regex sobre valores string (`PII_PATTERNS`).
   - Rechaza con código `pii_not_allowed`. La razón nunca incluye el valor offensivo (req 9.5).

2. **Construcción de payload** (`buildReferralRequest`):
   - Extrae sólo `location` y `pathology_code`. Cualquier otra clave del formInput se descarta explícitamente (req 6.2).
   - Genera `request_id` con `crypto.randomUUID()` (o ULID si se prefiere).

3. **Logging seguro** (`log_scrubber`):
   - Reemplaza patrones PII por marcadores. Truncar valores en `extra` cuyas claves son PII.
   - Nadie llama directo a `console.*`; toda salida pasa por `log` (req 9.3).

4. **Identificadores opacos**:
   - `request_id` no se deriva de inputs del operador.
   - El historial usa `caps_id` (que ya es opaco al venir del REFES).

5. **Limpieza al desmontar**:
   - `referral_view.unmount()` borra el estado local del formulario y cualquier referencia a `formInput` (req 9.6).
   - `tabs` invoca `unmount()` cuando el operador cambia de pestaña.

6. **Prohibido en almacenamiento**:
   - `localStorage` reservado a favoritos e historial sin PII.
   - `sessionStorage`, IndexedDB y cookies: `persistence` no los toca; un test verifica que ninguna llamada `setItem` con claves PII ocurra durante la sesión (req 9.2).

## Configuración (`App_Config`)

Declarada en `prototype/config.js`:

```js
export const APP_CONFIG = Object.freeze({
  regionCode: "06",                                  // o ["06", "02"]
  refesStaticPath: "./data/refes.json",
  pathologyCatalogPath: "./data/pathology_catalog.json",
  capacityProvider: "mock",                          // "mock" | "future_api"
  capacityMockPath: "./data/capacity_mock.json",
  populationMockPath: "./data/population_mock.json",
  lowCoverageThreshold: 5000,
  rankingWeights: { distance: 0.5, capacity: 0.3, services: 0.2 },
  referralMaxResults: 5,
  roleTabsEnabled: true,
  role: undefined,                                   // "ministry" | "operator" | undefined
  georefApiBaseUrl: "https://apis.datos.gob.ar/georef/api",
});
```

`bootstrap` aplica overrides desde `window.location.search`:
- `?region=06,02` → `regionCode = ["06", "02"]`
- `?role=ministry` → `role = "ministry"`
- `?capacityProvider=future_api` → fuerza el stub.

Validación al arranque (req 10.4):
- Claves obligatorias: `regionCode`, `refesStaticPath`, `pathologyCatalogPath`, `capacityProvider`. Si falta alguna o `capacityProvider` no está en `{"mock", "future_api"}`, falla con un cartel visible y `console.error` con el código `config_error`.

Lint rule (req 10.6): un test de fuente verifica que ningún módulo dentro de `prototype/modules` o `prototype/ui` contenga URLs `http(s)://` o números mágicos para los thresholds — todos deben pasar por `App_Config`.

## Error Handling

| Origen | Comportamiento |
|---|---|
| `fetch(refes.json)` falla red | UI: banner "no se pudo cargar el dataset". `log.error("refes_load_failed", { code: "network_error" })`. La app renderiza UI vacía pero no se rompe. |
| JSON malformado | Igual al anterior con `code: "parse_error"`. |
| Coordenadas inválidas en algún registro | Se descarta y se cuenta. `log.warn("refes_record_skipped", { reason: "invalid_coords" })` sin imprimir el registro. |
| Georef caído / 5xx | UI: mensaje neutral "no se pudo geocodificar la dirección". Operador puede ingresar coordenadas manualmente. |
| `pii_not_allowed` | UI: mensaje neutral, NO se invoca Georef ni engine, NO se loguea contenido. |
| `unknown_pathology` | UI: mensaje, no se invoca engine. |
| `no_caps_available` | UI: lista vacía + texto explicativo. Se persiste entrada de historial con ranking vacío. |
| `capacity_provider` valor inválido | App falla el arranque con cartel y `console.error("config_error")`. |
| `localStorage` quota excedida | `persistence` rechaza, UI muestra mensaje neutral y sigue operando. |

## Testing Strategy

Alineada con `.kiro/steering/testing.md`:

### Cliente (JS)

- **Runner**: Vitest con `environment: "jsdom"`.
- **PBT**: `fast-check` ≥ 3.x.
- **DOM**: `@testing-library/dom` para componentes UI.
- **Cobertura**: mínimo 70 % en `prototype/modules/**`.

Convenciones:
- Naming: `should_<behavior>_when_<condition>`.
- Property tests con `fc.assert(fc.property(...), { numRuns: 100 })` mínimo.
- Tag por test: `// Feature: geosalud-derivaciones-caps, Property N: <título>`.

Generators (en `tests/js/helpers/arbitraries.js`):

```js
export const arbCoordinates = fc.record({
  lat: fc.double({ min: -90, max: 90, noNaN: true }),
  lon: fc.double({ min: -180, max: 180, noNaN: true }),
});

export const arbCapsRecord = fc.record({
  caps_id: fc.string({ minLength: 1 }),
  name: fc.string(),
  coordinates: arbCoordinates,
  services: fc.array(fc.constantFrom("clinica_general", "pediatria", "vacunatorio")),
  region_code: fc.constantFrom("06", "02", "10"),
  /* ... */
});
```

### Script Python

- **Runner**: `pytest` + `pytest-asyncio`.
- Mockea las tools del MCP con `pytest-mock`/`respx`.
- Mockea Georef con `respx`.
- Tests cubren: filtrado por tipología, filtrado por región, descarte de coordenadas inválidas, normalización con Georef, formato del JSON de salida, idempotencia de re-ejecución.

## Correctness Properties

*Una propiedad es una característica o comportamiento que debe cumplirse en toda ejecución válida del sistema. Sirven de puente entre la especificación humana y garantías verificables por máquina. Cada propiedad debajo está derivada del prework y es testeable con fast-check (cliente) o pytest (script).*

### Property 1: Filtro REFES preserva tipología, región y coordenadas válidas

For any input array of raw REFES records and any `regionCodes`, the output of `fetch_refes_via_mcp` contains only records whose `tipologia ∈ CAPS`, whose `region_code ∈ regionCodes`, and whose coordinates are within `[-90, 90] × [-180, 180]`; every output record has a non-null `admin.province_id` and `admin.province_name` after Georef normalization.

**Validates: Requirements 2.3, 2.4, 2.5**

### Property 2: REFES loader runtime descarta inválidos

For any JSON array fetched from `refesStaticPath`, `loadRefes` returns exactly the subset of records with valid coordinates and required fields, and never throws when the input contains some invalid records mixed with valid ones.

**Validates: Requirements 3.1, 3.2**

### Property 3: Dataset REFES no se persiste

For any successful or failed REFES load, after `loadRefes` returns, `localStorage` does not contain any key holding the REFES dataset (no key matches `/refes|caps_dataset/i` and no value contains the items array verbatim).

**Validates: Requirements 3.4**

### Property 4: Haversine es métrica acotada

For any two coordinates `a` and `b`, `haversine(a, a) === 0`, `haversine(a, b) === haversine(b, a)` (within float tolerance), and `0 ≤ haversine(a, b) ≤ π · 6371.0088`.

**Validates: Requirements 6.4**

### Property 5: Coverage indicator es población dividida CAPS o nulo

For any `(population, capsCount, threshold)`, `computeUnit` returns `indicator = population / capsCount` with `status = "ok"` when `population != null ∧ capsCount > 0`; otherwise returns `indicator = null` with `status = "unknown_population"`.

**Validates: Requirements 4.2, 4.4**

### Property 6: Low coverage flag respeta el umbral

For any computed `CoverageResult` and any non-negative threshold, `low_coverage` is `true` if and only if `indicator != null ∧ indicator >= threshold`.

**Validates: Requirements 4.3**

### Property 7: `buildReferralRequest` elimina PII

For any form input object containing arbitrary keys (including any subset of `FORBIDDEN_KEYS` with arbitrary string values) plus a valid `location` and `pathology_code`, the resulting `ReferralRequest` contains exactly the keys `{ request_id, location, pathology_code, region_codes }` and none of `FORBIDDEN_KEYS`.

**Validates: Requirements 6.2**

### Property 8: PII validator rechaza claves prohibidas y patrones PII

For any form input that contains at least one key from `FORBIDDEN_KEYS` or at least one string value matching any pattern in `PII_PATTERNS`, `pii_validator.validate` returns `{ ok: false, code: "pii_not_allowed" }` and the returned `reason` does not include any value of the offending field.

**Validates: Requirements 9.5**

### Property 9: `scrub` elimina PII y es idempotente

For any string and `extra` object, `scrub` replaces every match of `PII_PATTERNS` with the corresponding marker, redacts every value whose key is in `FORBIDDEN_KEYS`, and `scrub(scrub(x)) === scrub(x)`.

**Validates: Requirements 9.3**

### Property 10: Cero PII en almacenes del navegador

For any sequence of operator interactions producing PII-bearing form inputs, no call to `localStorage.setItem`, `sessionStorage.setItem`, `indexedDB.*` or `document.cookie` is made with a value that contains any string matching `PII_PATTERNS` or any key from `FORBIDDEN_KEYS`.

**Validates: Requirements 9.1, 9.2, 9.6**

### Property 11: Entradas de historial bien formadas

For any successful referral execution, the entry appended to `geosalud:referralHistory` has exactly the keys `{ request_id, pathology_code, region_codes, distance_km, ranked_caps_ids, timestamp, schemaVersion }`, the `request_id` matches a UUID/ULID format, and no value contains substrings matching `PII_PATTERNS`.

**Validates: Requirements 6.11, 9.4**

### Property 12: Ranking bien formado

For any input `(caps, pathology, capacityProvider, config)`, the output of `referral_engine.rank` satisfies: every ranked CAPS declares at least one service in `pathology.required_services`; the array is sorted in non-increasing order of `score`; and `length ≤ config.referralMaxResults`.

**Validates: Requirements 6.5, 6.6, 6.7**

### Property 13: Mock provider marca origen y degrada limpio

For any `caps_id`, `Mock_Capacity_Provider.getCapacity(id)` returns a snapshot with `capacitySource === "mock"`; if `id` is not present in the mock dataset, the snapshot has `availability === "unknown"`.

**Validates: Requirements 7.5, 7.7**

### Property 14: Future API stub siempre `not_implemented`

For any `caps_id` and any operation among `getCapacity / getSupplies / getWaitingTime`, `Future_API_Capacity_Provider` returns a snapshot with `availability === "not_implemented"` and `capacitySource === "future_api"`, without throwing.

**Validates: Requirements 7.8**

### Property 15: Favoritos round-trip en `localStorage`

For any list of distinct `caps_id` values, after calling `persistence.writeFavorites(ids)` the next `persistence.readFavorites()` returns an array equal to `ids` (set equality), and the underlying `geosalud:favorites` value parses to a record with `schemaVersion === 1`.

**Validates: Requirements 5.6**

### Property 16: Visibilidad de tabs según rol

For any combination of `(roleTabsEnabled, role)`, the visible tabs match the matrix: `roleTabsEnabled=false` → both visible; `roleTabsEnabled=true ∧ role="ministry"` → only Analytics_View; `roleTabsEnabled=true ∧ role="operator"` → only Referral_View; `roleTabsEnabled=true ∧ role` undefined → both visible.

**Validates: Requirements 8.3**

### Property 17: Validación estricta de `App_Config`

For any candidate `App_Config` lacking at least one of the required keys (`regionCode`, `refesStaticPath`, `pathologyCatalogPath`, `capacityProvider`) or whose `capacityProvider ∉ {"mock", "future_api"}`, `bootstrap` rejects startup with a `config_error` and never instantiates the engine; conversely, for any valid candidate, startup proceeds.

**Validates: Requirements 10.2, 10.4**

### Property 18: Query params overriden defaults

For any subset of supported query parameters with valid values, after applying overrides the effective `App_Config` has the overridden values for those keys and equals the defaults for the rest.

**Validates: Requirements 10.3**

### Property 19: Georef sólo HTTPS

For any address geocoding call, the URL passed to `fetch` starts with `https://` and equals `${App_Config.georefApiBaseUrl}/...` with `georefApiBaseUrl` matching `^https://`.

**Validates: Requirements 8.5**

### Property 20: Agregados de cobertura coherentes con el dataset

For any list of `CoverageResult` units, `aggregate(units)` returns `caps_total = Σ caps_count`, `population_total = Σ population` (skipping `null`), `low_coverage_zones = |{ u : u.low_coverage }|`, and `coverage_indicator_avg = mean({ u.indicator : u.indicator != null })` (or `null` if all are `null`).

**Validates: Requirements 5.4**

### Property 21: `regionCode` lista escala sin cambios estructurales

For any `regionCode` input given as `string` or `string[]`, `loadRefes` and `referral_engine.rank` accept both forms and the resulting set of selected CAPS equals the union over each region in the list.

**Validates: Requirements 10.5**

