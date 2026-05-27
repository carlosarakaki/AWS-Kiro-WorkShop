# Design Document — GeoSalud: Derivaciones a CAPS

## Overview

GeoSalud es una aplicación web única con dos vistas (Analytics_View y Referral_View) que combina:

- Tablero analítico georreferenciado para ministerios sobre cobertura de CAPS.
- Herramienta operativa de derivación que dada la ubicación del paciente y una patología, devuelve un ranking de CAPS recomendados.

El sistema toma como fuente real de establecimientos el dataset REFES, normaliza geografía con la API Georef de Argentina, calcula indicadores de cobertura usando población INDEC y modela capacidad operativa con una interfaz abstracta (`Capacity_Provider`) que arranca con un Mock cargado desde CSV/JSON y prevé reemplazo por una API ministerial real.

El backend corre en AWS Lambda detrás de API Gateway, el frontend es React + Leaflet.js (TypeScript strict) y toda la infraestructura se despliega como código (CDK preferido) cumpliendo Well-Architected y los steering files del proyecto (`security`, `aws-architecture`, `coding-standards`, `testing`).

## Architecture

### Diagrama lógico

```
┌────────────────────────────┐         ┌────────────────────────────────────────────┐
│  Frontend (React+Leaflet)  │         │        AWS — geosalud-{env}-*              │
│  ─ Analytics_View          │         │                                            │
│  ─ Referral_View           │  HTTPS  │   ┌──────────────┐   ┌──────────────────┐  │
│   tabs por rol             ├─────────┤──▶│ API Gateway  │──▶│ Lambda handlers  │  │
│  Vite + TS strict          │         │   │  (REST)      │   │  (Python 3.12)   │  │
└────────────────────────────┘         │   └──────────────┘   └────────┬─────────┘  │
                                       │                               │            │
                                       │   ┌──────────────────────────▼──────────┐  │
                                       │   │ Domain core (puro)                  │  │
                                       │   │  REFES_Loader · Referral_Engine     │  │
                                       │   │  Coverage_Calculator · PII_Validator│  │
                                       │   │  Capacity_Provider (Strategy)       │  │
                                       │   │   ├─ Mock_Capacity_Provider         │  │
                                       │   │   └─ Ministry_API_Capacity_Provider │  │
                                       │   │  Georef_Client                      │  │
                                       │   └────┬───────────────┬────────────────┘  │
                                       │        │               │                   │
                                       │  ┌─────▼─────┐    ┌────▼──────┐            │
                                       │  │ S3 buckets│    │ DynamoDB  │            │
                                       │  │ (datasets │    │ (CAPS,    │            │
                                       │  │  raw +    │    │  capacity │            │
                                       │  │  catálogo)│    │  cache,   │            │
                                       │  │           │    │  catálogo)│            │
                                       │  └───────────┘    └───────────┘            │
                                       │                                            │
                                       │  CloudWatch Logs/Metrics · Secrets Manager │
                                       └────────────┬───────────────────────────────┘
                                                    │
                                                    ▼
                          ┌────────────────────────────────────────────────┐
                          │ Fuentes externas                                │
                          │  REFES (datos.salud.gob.ar / datos.gob.ar)      │
                          │  Georef (apis.datos.gob.ar/georef)              │
                          │  INDEC (dataset poblacional)                    │
                          │  Ministry API (futuro, vía stub)                │
                          └────────────────────────────────────────────────┘
```

### Decisiones arquitectónicas clave

- **Serverless por defecto**: Lambda + API Gateway cumple el principio "preferir serverless" del steering `aws-architecture` y se ajusta al perfil de tráfico esperado (operadores y funcionarios, picos esporádicos, latencias humanas).
- **Hexagonal / Clean Architecture**: el dominio (`Referral_Engine`, `Coverage_Calculator`, `REFES_Loader`) es Python puro sin dependencias de AWS. Los adaptadores (`s3_repository`, `dynamodb_repository`, `georef_http_client`, `secrets_provider`) implementan puertos definidos por el dominio. Esto habilita unit y property tests rápidos sin LocalStack.
- **Strategy para Capacity_Provider**: contrato único, dos implementaciones intercambiables por env var `GEOSALUD_CAPACITY_PROVIDER`.
- **REFES como dato derivado**: el dataset crudo se almacena en S3; la versión normalizada y filtrada se materializa en DynamoDB para servirse con baja latencia.
- **PII fuera del sistema**: el backend solo recibe ubicación y patología en derivación. Validador en el borde rechaza payloads con campos PII; logs pasan por `scrub_log` antes de ir a CloudWatch.
- **IaC con CDK (TypeScript)**: alineado al stack del proyecto; permite stacks separados por capa.

## Components and Interfaces

### Backend — Componentes

#### `REFES_Loader`

Responsable de cargar y normalizar el REFES.

```python
class RefesLoader:
    def __init__(
        self,
        http_client: HttpClient,
        georef_client: GeorefClient,
        repository: CapsRepository,
        config: RefesConfig,
        clock: Clock,
    ) -> None: ...

    def run(self) -> LoadResult:
        """Descarga, filtra por región y tipología CAPS, normaliza geografía,
        descarta coordenadas inválidas, persiste en repository."""
```

Reglas:

- Descarga con backoff exponencial (1s, 2s, 4s) — máximo 3 reintentos. Ante fallo total, devuelve `LoadResult.failed(reason)` y conserva la versión previa en DynamoDB.
- Filtra por `GEOSALUD_REGION_CODE` (string o lista CSV) y por tipología CAPS.
- Valida coordenadas en `[-90, 90] × [-180, 180]`.
- Llama a `Georef_Client.normalize_admin(...)` para obtener IDs y nombres canónicos de provincia/departamento/municipio/localidad.
- Logs operativos pasan por `scrub_log` (sin PII; identificadores opacos para registros descartados).

#### `Referral_Engine`

Núcleo del flujo operativo.

```python
class ReferralEngine:
    def __init__(
        self,
        caps_repository: CapsRepository,
        capacity_provider: CapacityProvider,
        pathology_catalog: PathologyCatalog,
        config: ReferralConfig,
    ) -> None: ...

    def rank(self, request: ReferralRequest) -> ReferralRanking:
        """1) Resuelve prestación a partir de patología
           2) Filtra CAPS de la región que ofrecen la prestación
           3) Calcula Haversine_Distance(paciente, caps)
           4) Pide capacidad a Capacity_Provider
           5) Calcula score con pesos GEOSALUD_RANKING_WEIGHTS
           6) Ordena descendente por score y trunca a GEOSALUD_REFERRAL_MAX_RESULTS"""
```

#### `Capacity_Provider` (interfaz)

```python
from typing import Protocol

class CapacityProvider(Protocol):
    name: str  # "mock" | "ministry_api"

    def get_capacity(self, caps_id: CapsId) -> CapacitySnapshot: ...
    def get_supplies(self, caps_id: CapsId) -> SuppliesSnapshot: ...
    def get_waiting_time(self, caps_id: CapsId) -> WaitingTimeSnapshot: ...
```

Implementaciones:

- `MockCapacityProvider`: lee CSV/JSON desde S3 (`GEOSALUD_CAPACITY_MOCK_URI`) en cold start, mantiene un dict en memoria. Devuelve `capacity_source="mock"` siempre y `availability="unknown"` cuando el `caps_id` no está en el archivo.
- `MinistryApiCapacityProvider` (stub): expone la misma firma; mientras `not_implemented`, devuelve `CapacitySnapshot.not_implemented()`. Prevé credenciales en Secrets Manager (`geosalud-{env}-ministry-api`) y circuit breaker con backoff cuando se implemente.

`CapacityProviderFactory` arranca el provider correcto según `GEOSALUD_CAPACITY_PROVIDER`. Valor no soportado → falla el arranque del Lambda con mensaje explícito.

#### `Georef_Client`

Cliente HTTP de la API Georef de Argentina.

```python
class GeorefClient:
    def normalize_admin(self, raw: AdminRaw) -> AdminNormalized: ...
    def geocode_address(self, address: str, region_hint: RegionCode | None) -> Coordinates | None: ...
```

- Timeouts cortos (2s connect, 5s read), 2 reintentos con backoff.
- Cachea respuestas en DynamoDB (`geosalud-{env}-georef-cache`) con TTL de 30 días.

#### `Coverage_Calculator`

```python
class CoverageCalculator:
    def compute_unit(self, unit: GeoUnit, caps_count: int, population: int | None, threshold: int) -> CoverageResult: ...
    def aggregate(self, units: list[CoverageResult]) -> RegionalAggregates: ...
```

`CoverageResult.indicator = population / caps_count` cuando ambos son positivos; `None` con `status="unknown_population"` cuando no hay datos. Marca `low_coverage=True` si `indicator >= threshold`.

#### `PII_Validator`

```python
class PiiValidator:
    def validate(self, body: Mapping[str, Any]) -> ValidationResult:
        """Rechaza si encuentra: dni, document_number, full_name, phone,
        email, exact_address (campos específicos), o patrones PII en strings."""
```

- Lista negra de claves prohibidas + regex para DNI argentino, teléfonos, correo y dirección con número de puerta exacto.
- Devuelve `ValidationResult.rejected(code="pii_not_allowed")` o `ValidationResult.ok()`.
- Se invoca como middleware antes de cualquier handler que reciba `Patient_Input`.

#### `Log_Scrubber`

```python
def scrub_log(message: str, extra: Mapping[str, Any] | None = None) -> ScrubbedLog: ...
```

- Reemplaza coincidencias de PII por marcadores (`<dni>`, `<phone>`, `<email>`, `<address>`).
- Aplica a todos los `logger.info/warn/error` antes de despacho a CloudWatch (handler centralizado).

### API Gateway — Endpoints

Base path: `/v1`. Todos sobre HTTPS (TLS 1.2+). Autenticación: API key inicial + planificación de Cognito en una iteración futura (fuera de alcance de este spec).

#### `GET /v1/caps`

Lista CAPS de la región configurada.

Request:

```
GET /v1/caps?bbox=-58.6,-34.7,-58.3,-34.5
Headers: x-api-key: <key>
```

Response 200:

```json
{
  "region_code": "06",
  "items": [
    {
      "caps_id": "REFES-12345",
      "name": "CAPS Belgrano",
      "address_normalized": "Av. Cabildo 1234, CABA",
      "coordinates": { "lat": -34.561, "lon": -58.456 },
      "admin": {
        "province_id": "06",
        "department_id": "06028",
        "municipality_id": "060280",
        "locality_id": "06028010"
      },
      "services": ["clinica_general", "pediatria"],
      "capacity": {
        "availability": "medium",
        "waiting_time_minutes": 35,
        "capacity_source": "mock"
      }
    }
  ]
}
```

#### `GET /v1/coverage`

Indicadores de cobertura por unidad geográfica.

Response 200:

```json
{
  "region_code": "06",
  "threshold": 5000,
  "units": [
    {
      "unit_id": "06028",
      "unit_kind": "department",
      "name": "Vicente López",
      "caps_count": 12,
      "population": 269420,
      "coverage_indicator": 22451.6,
      "status": "ok",
      "low_coverage": true
    },
    {
      "unit_id": "06035",
      "unit_kind": "department",
      "name": "X",
      "caps_count": 0,
      "population": null,
      "coverage_indicator": null,
      "status": "unknown_population",
      "low_coverage": false
    }
  ],
  "aggregates": {
    "caps_total": 145,
    "population_total": 1450000,
    "coverage_indicator_avg": 12300.0,
    "low_coverage_zones": 7
  }
}
```

#### `POST /v1/referral`

Genera el ranking de CAPS recomendados.

Request:

```json
{
  "location": {
    "kind": "address" | "coordinates",
    "address": "Av. Siempreviva 742, Springfield",
    "coordinates": { "lat": -34.61, "lon": -58.41 }
  },
  "pathology_code": "RESP_AGUDA"
}
```

- `location` debe ser `address` XOR `coordinates`. El validador PII rechaza el cuerpo si trae claves no permitidas.

Response 200:

```json
{
  "request_id": "rid_01HXY...",
  "patient_location": { "lat": -34.61, "lon": -58.41 },
  "pathology": { "code": "RESP_AGUDA", "label": "Afección respiratoria aguda" },
  "ranking": [
    {
      "caps_id": "REFES-12345",
      "name": "CAPS Belgrano",
      "distance_km": 1.42,
      "compatible_services": ["clinica_general"],
      "capacity": {
        "availability": "high",
        "waiting_time_minutes": 12,
        "capacity_source": "mock"
      },
      "score": 0.87
    }
  ]
}
```

Errores:

| Código HTTP | error_code | Origen |
|---|---|---|
| 400 | `pii_not_allowed` | `PII_Validator` |
| 400 | `unknown_pathology` | `Referral_Engine` |
| 400 | `invalid_location` | parsing/Georef sin resultado |
| 200 | ranking vacío + `meta.code = "no_caps_available"` | sin CAPS compatibles |
| 502 | `upstream_error` | Georef caído tras reintentos |

Ejemplo error 400:

```json
{ "error_code": "unknown_pathology", "message": "Pathology code not found in catalog" }
```

#### Endpoints internos / utilitarios

- `POST /v1/admin/refes/reload` — dispara `REFES_Loader` (auth restringida, fuera del flujo público).
- `GET /v1/health` — smoke check.

## Data Models

### Modelos de dominio (Python `dataclass` + `pydantic` v2 para serialización)

```python
@dataclass(frozen=True)
class Coordinates:
    lat: float
    lon: float

@dataclass(frozen=True)
class AdminNormalized:
    province_id: str
    province_name: str
    department_id: str | None
    department_name: str | None
    municipality_id: str | None
    municipality_name: str | None
    locality_id: str | None
    locality_name: str | None

@dataclass(frozen=True)
class CapsRecord:
    caps_id: str             # opaco, derivado del id REFES
    name: str
    address_normalized: str
    coordinates: Coordinates
    admin: AdminNormalized
    services: tuple[str, ...]
    region_code: str
    source_version: str      # versión del dataset REFES

@dataclass(frozen=True)
class CapacitySnapshot:
    caps_id: str
    availability: Literal["high", "medium", "low", "unknown", "not_implemented"]
    waiting_time_minutes: int | None
    supplies_status: Literal["ok", "low", "missing", "unknown"]
    capacity_source: Literal["mock", "ministry_api"]
    captured_at: datetime

@dataclass(frozen=True)
class PathologyEntry:
    code: str
    label: str
    required_services: tuple[str, ...]

@dataclass(frozen=True)
class CoverageResult:
    unit_id: str
    unit_kind: Literal["province", "department", "municipality", "locality"]
    caps_count: int
    population: int | None
    indicator: float | None
    status: Literal["ok", "unknown_population"]
    low_coverage: bool

@dataclass(frozen=True)
class ReferralRequest:
    request_id: str          # opaco, generado server-side
    location: Coordinates    # ya normalizada
    pathology_code: str
    region_code: str

@dataclass(frozen=True)
class RankedCap:
    caps_record: CapsRecord
    distance_km: float
    capacity: CapacitySnapshot
    compatible_services: tuple[str, ...]
    score: float
```

### Almacenamiento en AWS

Decisión: **DynamoDB para datos servidos en línea, S3 para datasets crudos y archivos de configuración (catálogo, mock de capacidad)**.

#### Justificación por access pattern

| Dato | Patrón de acceso | Servicio | Justificación |
|---|---|---|---|
| Dataset REFES crudo | Descarga/extracción asíncrona, lectura en bulk una vez por job | **S3** | Tamaño grande, lectura batch, bajo costo, versionado nativo (S3 Versioning) para conservar la versión previa ante fallo de carga (Req 1.7). |
| CAPS normalizados | Lookup por `caps_id`, listado por `region_code`, lectura en cada request | **DynamoDB** | Single-digit ms latency, lookup directo por PK, queries por GSI de región. La tabla se reescribe completa por job de carga (no high-write). |
| Capacity mock dataset (CSV/JSON) | Lectura en cold start del Lambda | **S3** | Archivo configurable por env var, versionado, fácil reemplazo por operador. |
| Capacity cache | Lookup por `caps_id`, TTL corto | **DynamoDB** (TTL nativo) | Único `caps_id` PK, TTL de 5 min para reducir llamadas a Ministry API en el futuro. |
| Catálogo de patologías | Lookup por `pathology_code` | **S3** + caché en memoria del Lambda | Archivo pequeño y estable, configurable por env var. Si el equipo decide editarlo desde una UI, migra a DynamoDB. |
| Población INDEC por unidad | Lookup por `unit_id` | **DynamoDB** | Acceso directo por PK. |
| Georef cache | Lookup por dirección normalizada | **DynamoDB** con TTL | Reduce dependencia y latencia de Georef. |

#### Esquemas DynamoDB

`geosalud-{env}-caps`

- PK: `caps_id` (string)
- GSI1: `region_code` (PK) → para listar CAPS de la región.
- GSI2: `province_id` (PK), `department_id` (SK) → cobertura agregada.
- Atributos: `name`, `address_normalized`, `coordinates`, `admin`, `services`, `source_version`.

`geosalud-{env}-population`

- PK: `unit_id` (string), SK: `unit_kind`
- Atributos: `name`, `population`, `source_version`.

`geosalud-{env}-pathology-catalog` (opcional; arranca como S3)

- PK: `pathology_code`
- Atributos: `label`, `required_services`.

`geosalud-{env}-capacity-cache`

- PK: `caps_id`
- TTL: `expires_at` (epoch).

`geosalud-{env}-georef-cache`

- PK: `cache_key` (hash de la consulta)
- TTL: 30 días.

#### Buckets S3

- `geosalud-{env}-datasets-raw` (versioning ON, SSE-S3): REFES crudo, snapshots históricos.
- `geosalud-{env}-config` (versioning ON, SSE-S3): `pathology_catalog.json`, `capacity_mock.csv`.
- `geosalud-{env}-frontend` (CloudFront origin): artefactos React.

Cifrado at-rest: SSE-S3 mínimo, SSE-KMS para `geosalud-{env}-config` si en algún momento incluye datos sensibles. DynamoDB con encryption at-rest activada (default AWS managed key).

## End-to-end Flow — Derivación

```
Operador (UI Referral_View)
  └─ ingresa ubicación (dirección o lat/lon) + patología
  └─ Frontend: build_request(input)  → strip de cualquier campo PII
  └─ POST /v1/referral
     └─ API Gateway → Lambda referral_handler
        ├─ PII_Validator.validate(body)        ──❌→ 400 pii_not_allowed
        ├─ parse(ReferralPayload)              ──❌→ 400 invalid_location
        ├─ if location.kind == "address":
        │    coords = Georef_Client.geocode_address(...)
        │    if coords is None                 ──❌→ 400 invalid_location
        ├─ pathology = PathologyCatalog.get(code) ──❌→ 400 unknown_pathology
        ├─ candidates = CapsRepository.list_by_region(region_code)
        ├─ filtered  = filter_by_services(candidates, pathology.required_services)
        │    if len(filtered) == 0             ──→ 200 { ranking: [], code: no_caps_available }
        ├─ for c in filtered:
        │     d   = haversine(coords, c.coordinates)
        │     cap = CapacityProvider.get_capacity(c.caps_id)
        │     s   = score(d, cap, services_match, weights)
        ├─ ranked = sort_desc_by_score(...)
        ├─ truncated = ranked[: GEOSALUD_REFERRAL_MAX_RESULTS]
        └─ response(request_id, location, pathology, truncated)
  └─ Frontend: pinta lista ordenada y resalta marcadores en Leaflet
```

Cada Lambda escribe logs vía `Log_Scrubber`. El `request_id` es ULID opaco generado server-side; nunca se deriva del `Patient_Input`.

## Algorithms

### Haversine

```python
EARTH_RADIUS_KM = 6371.0088

def haversine(a: Coordinates, b: Coordinates) -> float:
    phi1, phi2 = radians(a.lat), radians(b.lat)
    d_phi = radians(b.lat - a.lat)
    d_lambda = radians(b.lon - a.lon)
    h = sin(d_phi / 2) ** 2 + cos(phi1) * cos(phi2) * sin(d_lambda / 2) ** 2
    return 2 * EARTH_RADIUS_KM * asin(min(1.0, sqrt(h)))
```

Propiedades esperadas (verificadas en property tests):

- Identidad: `haversine(p, p) == 0`.
- Simetría: `haversine(a, b) == haversine(b, a)`.
- Rango: `0 <= haversine(a, b) <= π · EARTH_RADIUS_KM`.

### Coverage Indicator

```
coverage_indicator(unit) =
    population(unit) / caps_count(unit)        si population is known and caps_count > 0
    None                                       en otro caso (status = unknown_population)

low_coverage(unit) = (coverage_indicator is not None) and (coverage_indicator >= threshold)
```

### Ranking score

Pesos en env var `GEOSALUD_RANKING_WEIGHTS` con formato JSON:

```
{ "distance": 0.5, "capacity": 0.3, "services": 0.2 }
```

El cargador normaliza pesos para que sumen 1.0 (rechaza si alguno es negativo o si la suma es 0).

```python
def score(distance_km: float,
          cap: CapacitySnapshot,
          services_match_ratio: float,
          weights: RankingWeights,
          max_distance_km: float) -> float:
    distance_term  = max(0.0, 1.0 - distance_km / max_distance_km)
    capacity_term  = AVAILABILITY_TO_SCORE[cap.availability]   # high=1.0, medium=0.6, low=0.2, unknown=0.4, not_implemented=0.0
    services_term  = services_match_ratio                      # |compatibles|/|requeridos|
    return (
        weights.distance * distance_term
      + weights.capacity * capacity_term
      + weights.services * services_term
    )
```

Propiedades esperadas:

- Score ∈ [0, 1] para todo input válido.
- Monotonía en distancia: a igualdad de capacidad y servicios, distancia menor ⇒ score mayor o igual.
- El ranking final está ordenado de forma descendente por score.
- `len(ranking) <= GEOSALUD_REFERRAL_MAX_RESULTS`.

## Infrastructure as Code

### Stack tooling

CDK en TypeScript (Node 20). Razón: alinea con el frontend en TS, expresividad para construct composition, primitivas para tags y aspectos. Si el equipo ya tiene workflow Terraform, se puede portar; el diseño de stacks aplica a ambos.

### Stacks

| Stack | Recursos principales |
|---|---|
| `geosalud-{env}-network-stack` | (Si aplica VPC para Ministry_API_*) VPC, subnets privadas, NAT, endpoints VPC para S3/DynamoDB/Secrets. En MVP, Lambdas fuera de VPC y este stack queda vacío. |
| `geosalud-{env}-data-stack` | S3 buckets (`datasets-raw`, `config`), DynamoDB tables (`caps`, `population`, `pathology-catalog`, `capacity-cache`, `georef-cache`). |
| `geosalud-{env}-api-stack` | Lambdas (`refes_loader`, `caps_handler`, `coverage_handler`, `referral_handler`, `health_handler`), API Gateway REST API, IAM roles, alarmas CloudWatch. |
| `geosalud-{env}-frontend-stack` | S3 bucket (`frontend`), CloudFront, OAC, ACM, Route 53 (si aplica). |
| `geosalud-{env}-secrets-stack` | Secrets Manager para Ministry API y otros futuros, KMS key opcional. |

### Naming y tags

- Naming: `geosalud-{env}-{resource}` (`dev`, `staging`, `prod`).
- Tags obligatorios aplicados con CDK Aspect global:
  - `Project = geosalud`
  - `Environment = {env}`
  - `Owner = ministerio-salud`
  - `CostCenter = geosalud-{env}`

### IAM

- Cada Lambda tiene un rol propio. Permisos mínimos:
  - `referral_handler`: `dynamodb:Query/GetItem` sobre `caps`, `pathology-catalog`, `capacity-cache`; `s3:GetObject` sobre `config/*`; `secretsmanager:GetSecretValue` solo para el secret puntual (cuando aplique); `logs:*` sobre su grupo.
  - `refes_loader`: `s3:GetObject/PutObject` sobre `datasets-raw/*`; `dynamodb:BatchWriteItem/PutItem` sobre `caps`; `logs:*`.
- Sin wildcards en recursos (`*`) salvo justificación documentada.
- Sin access keys de larga duración: roles asumidos por el servicio.

### Secrets Manager

- `geosalud-{env}-ministry-api`: credenciales para Ministry_API_Capacity_Provider, rotación cada 90 días vía Secrets Manager.
- `geosalud-{env}-georef`: si Georef pasa a requerir token (hoy es público).
- Nunca en variables de entorno en texto plano. Las Lambdas obtienen el ARN del secret por env var y leen el valor en cold start.

### Configuración por entorno

Variables de entorno por Lambda (declaradas en CDK):

```
GEOSALUD_REGION_CODE
GEOSALUD_REFES_DATASET_URL
GEOSALUD_REFES_STORAGE_URI
GEOSALUD_INDEC_DATASET_URI
GEOSALUD_CAPACITY_PROVIDER         # "mock" | "ministry_api"
GEOSALUD_CAPACITY_MOCK_URI         # s3://geosalud-{env}-config/capacity_mock.csv
GEOSALUD_PATHOLOGY_CATALOG_URI     # s3://geosalud-{env}-config/pathology_catalog.json
GEOSALUD_LOW_COVERAGE_THRESHOLD
GEOSALUD_RANKING_WEIGHTS           # JSON con distance/capacity/services
GEOSALUD_REFERRAL_MAX_RESULTS
GEOSALUD_API_BASE_URL              # consumido por frontend
GEOSALUD_ROLE_TABS_ENABLED
GEOSALUD_LOG_LEVEL
```

### Observabilidad

- CloudWatch Logs por Lambda (retención 30 días en `dev`/`staging`, 365 en `prod`).
- Métricas custom en namespace `GeoSalud/{env}`: `ReferralRequests`, `ReferralLatencyMs`, `RefesLoadFailures`, `PiiRejected`.
- Alarmas: API Gateway 5xx > 1% en 5 min, latencia p95 > 1500 ms, DLQ del refes_loader (si se materializa con Step Functions o EventBridge).

## Error Handling

| Capa | Estrategia |
|---|---|
| Validación | `PII_Validator` y parsers Pydantic devuelven errores estructurados → 400 con `error_code` y mensaje neutro. |
| Lógica de dominio | Excepciones de dominio tipadas (`UnknownPathology`, `NoCapsAvailable`) capturadas en el handler para mapear a HTTP. |
| Integraciones externas | `tenacity` con backoff exponencial; circuit breaker simple (`pybreaker`) para Ministry API. Fallos persistentes → 502 `upstream_error` con log scrubeado. |
| Persistencia | Excepciones de DynamoDB/S3 mapeadas a 503 con retry hint. |
| Logging de errores | Todo error pasa por `scrub_log` antes de CloudWatch. Stack traces en `dev`, mensaje genérico en `prod` para evitar exposición. |
| Frontend | Captura errores de fetch y muestra mensajes neutros al usuario. Guarda solo `request_id` y `error_code` para soporte. |

## PII Handling Strategy

Foco: el Patient_Input no debe entrar a almacenamiento ni logs.

1. **Validación de input**:
   - `PII_Validator` con dos capas: lista de claves prohibidas (`dni`, `documento`, `nombre`, `apellido`, `telefono`, `email`, `obra_social`, `historia_clinica`, `direccion_exacta`) y regex sobre los `string` recibidos (DNI argentino `\b\d{7,8}\b`, teléfonos, emails, direcciones con altura).
   - Rechaza con 400 `pii_not_allowed` si encuentra coincidencias.
2. **Scrubbing de logs**: handler central `scrub_log` aplica regex al mensaje y a `extra` antes de despacharlo. Nunca logear `body` crudo.
3. **Identificadores opacos**: `request_id` es un ULID generado en el handler, no derivado del payload. Todas las correlaciones internas (métricas, logs, X-Ray) usan ese id.
4. **Persistencia cero**: el `referral_handler` mantiene `Patient_Input` en variables locales; el ciclo de vida termina con el response.
5. **Frontend**: nunca usa `localStorage`, `sessionStorage` ni cookies para `Patient_Input`. Se mantiene en estado de React durante la sesión de la pantalla y se limpia al desmontar el componente.
6. **Métricas agregadas**: solo categorías (patología, unidad geográfica, código de error). Nada que permita reidentificación.
7. **Retención**: logs CloudWatch sin PII; KMS para `geosalud-{env}-config` si futuras versiones agregan datos sensibles.

## Directory Structure

```
geosalud/
├── README.md
├── .gitignore
├── .pre-commit-config.yaml          # detect-secrets, ruff, black, eslint
│
├── backend/                         # Python 3.12, uv/poetry
│   ├── pyproject.toml
│   ├── ruff.toml
│   ├── src/
│   │   └── geosalud/
│   │       ├── __init__.py
│   │       ├── domain/              # Núcleo puro, sin AWS
│   │       │   ├── models.py        # dataclasses
│   │       │   ├── haversine.py
│   │       │   ├── coverage.py
│   │       │   ├── ranking.py
│   │       │   ├── refes_loader.py
│   │       │   ├── referral_engine.py
│   │       │   ├── pii_validator.py
│   │       │   └── log_scrubber.py
│   │       ├── ports/               # Interfaces (Protocol/ABC)
│   │       │   ├── capacity_provider.py
│   │       │   ├── caps_repository.py
│   │       │   ├── pathology_catalog.py
│   │       │   ├── georef_client.py
│   │       │   └── http_client.py
│   │       ├── adapters/            # Implementaciones AWS / HTTP
│   │       │   ├── capacity/
│   │       │   │   ├── mock.py
│   │       │   │   └── ministry_api.py
│   │       │   ├── repositories/
│   │       │   │   ├── caps_dynamodb.py
│   │       │   │   ├── population_dynamodb.py
│   │       │   │   └── catalog_s3.py
│   │       │   ├── georef_http.py
│   │       │   ├── secrets_manager.py
│   │       │   └── s3_storage.py
│   │       ├── handlers/            # Entrypoints Lambda
│   │       │   ├── caps_handler.py
│   │       │   ├── coverage_handler.py
│   │       │   ├── referral_handler.py
│   │       │   ├── refes_loader_handler.py
│   │       │   └── health_handler.py
│   │       ├── config.py            # carga y validación de env vars
│   │       └── factories.py         # CapacityProviderFactory, etc.
│   └── tests/
│       ├── unit/
│       │   ├── test_haversine_properties.py
│       │   ├── test_ranking_properties.py
│       │   ├── test_coverage_properties.py
│       │   ├── test_refes_loader_properties.py
│       │   ├── test_pii_validator_properties.py
│       │   ├── test_log_scrubber_properties.py
│       │   └── test_capacity_mock_properties.py
│       ├── integration/
│       │   ├── test_caps_repository_dynamodb.py    # moto
│       │   ├── test_capacity_mock_s3.py
│       │   └── test_referral_handler_e2e.py
│       └── conftest.py
│
├── frontend/                        # React + Vite + TS strict
│   ├── package.json
│   ├── tsconfig.json
│   ├── eslint.config.js
│   ├── vite.config.ts
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── api/
│   │   │   ├── client.ts            # fetch wrapper, lee GEOSALUD_API_BASE_URL
│   │   │   └── buildReferralRequest.ts
│   │   ├── views/
│   │   │   ├── AnalyticsView.tsx
│   │   │   └── ReferralView.tsx
│   │   ├── components/
│   │   │   ├── MapCanvas.tsx        # Leaflet
│   │   │   ├── CapsMarker.tsx
│   │   │   ├── LowCoverageLayer.tsx
│   │   │   ├── CoverageDashboard.tsx
│   │   │   ├── RankingList.tsx
│   │   │   └── RoleAwareTabs.tsx
│   │   ├── hooks/
│   │   │   └── useReferral.ts
│   │   ├── state/
│   │   │   └── aggregates.ts        # cálculo de agregados (puro, testeable)
│   │   └── utils/
│   │       └── stripPii.ts
│   └── tests/
│       ├── unit/
│       │   ├── buildReferralRequest.test.ts   # property test
│       │   └── aggregates.test.ts             # property test
│       └── components/
│           └── *.test.tsx
│
├── infra/                           # AWS CDK (TypeScript)
│   ├── package.json
│   ├── cdk.json
│   ├── bin/
│   │   └── geosalud.ts
│   └── lib/
│       ├── stacks/
│       │   ├── data-stack.ts
│       │   ├── api-stack.ts
│       │   ├── frontend-stack.ts
│       │   └── secrets-stack.ts
│       ├── constructs/
│       │   ├── lambda-fn.ts         # construct con tags + role mínimo
│       │   └── tagging-aspect.ts
│       └── config/
│           └── env-config.ts
│
└── ops/
    ├── scripts/                     # carga de mocks, smoke tests
    └── data-samples/                # capacity_mock.csv, pathology_catalog.json
```

## Testing Strategy

Cumple la pirámide de `testing.md`: 70% unit, integración para contratos, E2E mínimo. Property-Based Testing focalizado en lógica pura del dominio.

### Herramientas

- Backend: `pytest`, `hypothesis` (PBT), `moto` para mocks AWS, `responses` para HTTP, `pip-audit` en CI.
- Frontend: `Vitest` + `fast-check` (PBT) + React Testing Library + `npm audit` en CI.
- IaC: `aws-cdk-lib/assertions` para snapshot de templates y verificación de tags/naming.

### Cobertura por componente

| Componente | Unit | PBT | Integration |
|---|---|---|---|
| `haversine` | sí | **sí** (P6) | — |
| `ranking` | sí | **sí** (P8) | — |
| `coverage` | sí | **sí** (P3, P4) | — |
| `refes_loader` (puro) | sí | **sí** (P1, P2) | con moto/responses |
| `pii_validator` | sí | **sí** (P11) | en handler |
| `log_scrubber` | sí | **sí** (P10) | — |
| `capacity_mock` | sí | **sí** (P9) | con moto S3 |
| `referral_engine` (orquestación) | sí | **sí** (P5, P7, P8) | en handler |
| `caps_repository` | — | — | moto DynamoDB |
| `referral_handler` | — | — | E2E con moto + API Gateway event |
| Frontend `aggregates`, `buildReferralRequest` | — | **sí** (P4, P5) | — |
| IaC stacks | snapshot | — | — |

### Convenciones

- Nombrado: `test_should_<behavior>_when_<condition>`.
- Mínimo **100 iteraciones** por property test (`@settings(max_examples=200)` por defecto).
- Cada property test referencia su propiedad del design:
  `# Feature: geosalud-derivaciones-caps, Property N: <texto>`.
- Tests deterministas: sin `datetime.now()` real, sin red. `Clock` y `HttpClient` se inyectan.

## Correctness Properties

*Una propiedad es una característica o comportamiento que debe mantenerse en todas las ejecuciones válidas del sistema. Las propiedades sirven de puente entre la especificación humana y las garantías de corrección verificables por máquina.*

### Property 1: REFES_Loader produce solo CAPS válidos de la región

*For any* lista de registros REFES y `region_code` configurado, el resultado de `RefesLoader.run()` SHALL contener únicamente registros cuyo código de región coincide con el configurado, cuya tipología es CAPS y cuyas coordenadas están en `[-90, 90] × [-180, 180]`. Ningún otro registro aparece en la salida.

**Validates: Requirements 1.2, 1.3, 1.5**

### Property 2: Persistencia de CAPS es round-trip

*For any* colección de `CapsRecord` normalizados, persistirla en `CapsRepository` y volver a leerla por el mismo `region_code` SHALL devolver una colección con el mismo conjunto de `caps_id` y los mismos atributos por registro.

**Validates: Requirements 1.6**

### Property 3: Coverage_Indicator obedece su definición y umbral

*For any* unidad geográfica con `caps_count >= 0` y población `p` (entero positivo o `None`) y umbral `t >= 0`:

- Si `p` es `None` o `caps_count == 0`, el `indicator` SHALL ser `None` y `status == "unknown_population"`.
- En otro caso, `indicator == p / caps_count` y `low_coverage` SHALL ser equivalente a `indicator >= t`.

**Validates: Requirements 2.2, 2.3, 2.4**

### Property 4: Reductor de agregados es la suma de partes

*For any* lista de `CoverageResult`, el agregado regional SHALL cumplir:
`caps_total == Σ caps_count`, `population_total == Σ population` (ignorando `None`), `low_coverage_zones == |{u | u.low_coverage}|` y `coverage_indicator_avg == promedio aritmético sobre indicadores no nulos`.

**Validates: Requirements 3.4**

### Property 5: build_request elimina PII del payload

*For any* objeto de entrada del operador (incluso si por error contiene `dni`, `nombre`, `telefono`, `email`, `direccion_exacta` u otros campos PII conocidos), el payload producido por `buildReferralRequest` SHALL contener únicamente las claves permitidas (`location`, `pathology_code`) y SHALL no incluir ningún campo identificado como PII.

**Validates: Requirements 4.2, 8.6**

### Property 6: Haversine es una métrica

*For any* par de coordenadas `a` y `b` en `[-90, 90] × [-180, 180]`:

- `haversine(a, a) == 0`.
- `haversine(a, b) == haversine(b, a)` (módulo tolerancia de punto flotante).
- `0 <= haversine(a, b) <= π · EARTH_RADIUS_KM`.

**Validates: Requirements 4.4**

### Property 7: Filtro por prestación produce CAPS compatibles

*For any* catálogo de patologías y conjunto de CAPS, `Referral_Engine.filter_by_services(caps, pathology)` SHALL devolver únicamente CAPS cuya colección `services` contiene al menos una de las `required_services` de la patología solicitada.

**Validates: Requirements 4.5**

### Property 8: Ranking respeta scoring, orden y cota de tamaño

*For any* lista de candidatos (CAPS, distancia, capacidad, servicios compatibles), pesos válidos y `max_results > 0`, el resultado de `Referral_Engine.rank(...)` SHALL cumplir:

- `len(result) <= max_results`.
- `result` está ordenado descendente por `score`.
- Cada `score ∈ [0, 1]`.
- A igualdad de capacidad y servicios compatibles, una distancia menor produce un score mayor o igual (monotonía en distancia).

**Validates: Requirements 4.6, 4.7**

### Property 9: Mock_Capacity_Provider mantiene su contrato

*For any* `caps_id` consultado, `MockCapacityProvider.get_capacity(caps_id)` SHALL devolver una `CapacitySnapshot` con `capacity_source == "mock"`. Si el `caps_id` no existe en el dataset, `availability == "unknown"`. Además, para todo dataset CSV/JSON válido, `parse(serialize(data)) == data` (round-trip de serialización).

**Validates: Requirements 5.4, 5.5, 5.7**

### Property 10: scrub_log elimina patrones PII

*For any* string `s` y atributos `extra` que contengan patrones PII conocidos (DNI argentino, teléfono, email, dirección exacta), `scrub_log(s, extra)` SHALL producir una salida que no contiene ninguna subcadena coincidente con esos patrones.

**Validates: Requirements 8.3**

### Property 11: Validador rechaza bodies con PII

*For any* cuerpo de request que contenga al menos una clave PII prohibida o un valor con un patrón PII reconocido, `PiiValidator.validate(body)` SHALL devolver `rejected` con `code == "pii_not_allowed"`. Recíprocamente, *for any* cuerpo cuyas claves estén en el conjunto permitido y cuyos valores no contengan patrones PII, `validate(body)` SHALL devolver `ok`.

**Validates: Requirements 8.6**

### Property 12: Config loader valida variables obligatorias

*For any* mapa de variables de entorno, `load_config(env)` SHALL devolver una configuración válida si y solo si todas las variables obligatorias (`GEOSALUD_REGION_CODE`, `GEOSALUD_REFES_DATASET_URL`, `GEOSALUD_INDEC_DATASET_URI`, `GEOSALUD_CAPACITY_PROVIDER`, `GEOSALUD_PATHOLOGY_CATALOG_URI`, `GEOSALUD_API_BASE_URL`) están presentes y bien formadas; en otro caso SHALL fallar con un error explícito que mencione la variable faltante o inválida.

**Validates: Requirements 9.3**
