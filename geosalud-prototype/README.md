# GeoSalud — Prototipo de derivaciones a CAPS

Prototipo estático (HTML + JS + CSS + JSON) para visualizar cobertura de CAPS y derivar pacientes a establecimientos compatibles.
Funciona 100% en el navegador, sin backend ni base de datos.

## Estructura del Static_Bundle

```
prototype/
├── index.html                  # Entrada única, monta tabs y carga app.js
├── app.js                      # Bootstrap: config, módulos, vistas
├── config.js                   # App_Config (objeto JS exportado)
├── styles.css                  # Estilos del prototipo
├── modules/                    # Lógica de dominio (refes_loader, referral_engine,
│                               #   coverage_calculator, capacity_provider, pii_validator,
│                               #   log_scrubber, persistence, georef_client, haversine, ...)
├── ui/                         # Componentes de UI (analytics_view, referral_view,
│                               #   map_canvas, ranking_list, coverage_panel, tabs)
├── data/                       # Datasets estáticos (refes.json, population_mock.json,
│                               #   pathology_catalog.json, capacity_mock.json)
└── vendor/                     # Librerías locales opcionales (Leaflet)
```

## Servir el prototipo de forma estática

- Con npm:
  ```bash
  npm run serve         # ejecuta `npx serve prototype`
  ```
- Con Python:
  ```bash
  python -m http.server 8080 --directory prototype
  # luego abrir http://localhost:8080
  ```
- Sin servidor: abrir directamente `prototype/index.html` con `file://` (puede haber limitaciones de `fetch` según el navegador).

## Regenerar el dataset REFES

Pre-requisito: el MCP `mcp-datos-abiertos-arg` debe estar disponible en el repositorio raíz (carpeta `mcp-datos-abiertos-arg/` con `index.json` ya generado).

```bash
python scripts/fetch_refes_via_mcp.py --region 06 --output prototype/data/refes.json
```

El script consulta datos.gob.ar vía el MCP, normaliza con la API Georef y materializa `prototype/data/refes.json`.

## Variables de configuración (`App_Config`)

Definidas en `prototype/config.js`:

- `regionCode`: código(s) de provincia/región a incluir (string o lista, p.ej. `"06"` o `["06", "02"]`).
- `refesStaticPath`: ruta al JSON con los CAPS (default `data/refes.json`).
- `pathologyCatalogPath`: ruta al catálogo de patologías y prestaciones requeridas.
- `capacityProvider`: estrategia de capacidad operativa (`"mock"` | `"future_api"`).
- `capacityMockPath`: ruta al JSON con la capacidad simulada.
- `populationMockPath`: ruta al JSON con la población por unidad geográfica.
- `lowCoverageThreshold`: umbral población/CAPS para marcar zona de baja cobertura.
- `rankingWeights`: pesos del ranking (`{ distance, capacity, services }`).
- `referralMaxResults`: cantidad máxima de CAPS recomendados por derivación.
- `roleTabsEnabled`: habilita la visibilidad por rol de los tabs de Analytics/Referral.
- `georefApiBaseUrl`: base HTTPS de la API Georef para geocodificar direcciones.

## Tests

- JavaScript (Vitest):
  ```bash
  npm test
  ```
- Python (pytest, para `scripts/`):
  ```bash
  pytest tests/python
  ```

## Override por query params

Cualquier propiedad de `App_Config` puede sobrescribirse desde la URL al cargar la página. Ejemplo:

```
prototype/index.html?region=06,02&role=ministry
```

Las listas se aceptan separadas por coma. Los valores no válidos se ignoran y se reporta un warning en consola (sin PII).
