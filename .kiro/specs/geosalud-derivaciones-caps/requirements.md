# Requirements Document

## Introduction

GeoSalud es una aplicación web única, con dos vistas separadas por tabs y roles, que combina un tablero analítico georreferenciado para ministerios y una herramienta operativa de derivación a Centros de Atención Primaria de la Salud (CAPS). El sistema utiliza el dataset REFES (Registro Federal de Establecimientos de Salud) como fuente real de establecimientos, datos de distribución poblacional del INDEC para indicadores de densidad y la API Georef para normalización geográfica. La capacidad operativa, los insumos y los tiempos de espera de cada CAPS se modelan inicialmente con datos simulados cargados desde un archivo CSV/JSON configurable, expuestos a través de una interfaz abstracta que permita reemplazar la fuente por una API ministerial real en el futuro. El alcance geográfico se limita a una provincia o municipio configurable por variable de entorno, manteniendo una arquitectura que permita escalar a nivel nacional. El backend corre en AWS Lambda detrás de API Gateway, el frontend usa React con Leaflet.js y toda la infraestructura se despliega mediante IaC (CDK o Terraform).

## Glossary

- **GeoSalud**: Sistema completo objeto de esta especificación.
- **Frontend**: Aplicación web React + Leaflet.js que expone las dos vistas.
- **Backend**: Conjunto de funciones AWS Lambda expuestas vía API Gateway.
- **REFES_Loader**: Componente backend que descarga, filtra y normaliza el dataset REFES según la región configurada.
- **Capacity_Provider**: Interfaz abstracta (patrón Strategy) que entrega datos de capacidad operativa, insumos y tiempos de espera por CAPS.
- **Mock_Capacity_Provider**: Implementación por defecto de Capacity_Provider que lee un CSV/JSON simulado.
- **Ministry_API_Capacity_Provider**: Implementación stub de Capacity_Provider preparada para integrar una API ministerial real.
- **Analytics_View**: Vista del tablero analítico con mapa de CAPS, indicadores de densidad y zonas de baja cobertura.
- **Referral_View**: Vista del flujo de derivación que recibe ubicación del paciente y patología, y devuelve ranking de CAPS.
- **Referral_Engine**: Componente backend que calcula el ranking de CAPS combinando distancia Haversine, capacidad y prestación.
- **Georef_Client**: Cliente del backend que invoca la API Georef para normalizar provincias, departamentos, municipios y localidades.
- **REFES**: Registro Federal de Establecimientos de Salud, dataset oficial publicado en datos.salud.gob.ar / datos.gob.ar.
- **CAPS**: Centro de Atención Primaria de la Salud, tipo de establecimiento del REFES sobre el que opera GeoSalud.
- **Region_Code**: Código de provincia o municipio configurado por la variable de entorno `GEOSALUD_REGION_CODE`.
- **Patient_Input**: Conjunto de datos transitorios provistos por el operador para una derivación: coordenadas o dirección del paciente y patología/síntoma.
- **PII**: Información personal identificable del paciente (nombre, documento, dirección exacta, teléfono, historia clínica).
- **Haversine_Distance**: Distancia geodésica calculada entre dos pares de coordenadas (lat, lon) usando la fórmula Haversine.
- **Coverage_Indicator**: Indicador de cobertura calculado como cantidad de habitantes por CAPS dentro de una unidad geográfica.
- **Low_Coverage_Zone**: Unidad geográfica cuyo Coverage_Indicator supera el umbral configurado en `GEOSALUD_LOW_COVERAGE_THRESHOLD`.
- **IaC**: Infraestructura como código, implementada en AWS CDK o Terraform.

## Requirements

### Requirement 1: Carga y normalización del dataset REFES

**User Story:** Como ministerio, quiero que GeoSalud cargue automáticamente los CAPS del dataset REFES filtrados por la región configurada, para trabajar con datos reales y actualizables sin intervención manual.

#### Acceptance Criteria

1. WHEN el Backend inicia un proceso de carga de establecimientos, THE REFES_Loader SHALL descargar el dataset REFES desde el endpoint configurado en la variable de entorno `GEOSALUD_REFES_DATASET_URL`.
2. WHERE la variable de entorno `GEOSALUD_REGION_CODE` está definida, THE REFES_Loader SHALL filtrar los registros del REFES conservando solo los establecimientos cuyo código de provincia o municipio coincida con `GEOSALUD_REGION_CODE`.
3. THE REFES_Loader SHALL conservar únicamente los establecimientos clasificados como CAPS según el campo de tipología del REFES.
4. WHEN el REFES_Loader procesa un establecimiento, THE REFES_Loader SHALL normalizar los campos de provincia, departamento, municipio y localidad invocando al Georef_Client antes de almacenar el registro.
5. IF un registro del REFES carece de coordenadas válidas (latitud o longitud nula, fuera del rango [-90, 90] o [-180, 180]), THEN THE REFES_Loader SHALL descartar el registro y registrar el identificador del establecimiento descartado en CloudWatch sin incluir datos sensibles.
6. WHEN el REFES_Loader finaliza la carga, THE REFES_Loader SHALL persistir los CAPS normalizados en el almacenamiento configurado por la variable de entorno `GEOSALUD_REFES_STORAGE_URI`.
7. IF la descarga del dataset REFES falla tras 3 reintentos con backoff exponencial, THEN THE REFES_Loader SHALL devolver un error operacional, registrar la falla en CloudWatch y mantener la versión previa del dataset disponible para consultas.

### Requirement 2: Indicadores de densidad poblacional por CAPS

**User Story:** Como ministerio, quiero ver indicadores de densidad de habitantes por CAPS, para detectar zonas con cobertura insuficiente.

#### Acceptance Criteria

1. THE Backend SHALL exponer un endpoint GET en API Gateway que devuelva, por cada unidad geográfica de la región configurada, la cantidad de CAPS, la población estimada y el Coverage_Indicator.
2. WHEN el Backend calcula el Coverage_Indicator de una unidad geográfica, THE Backend SHALL usar la población publicada por INDEC para esa unidad, leída desde la fuente configurada en `GEOSALUD_INDEC_DATASET_URI`.
3. WHEN el Backend identifica unidades geográficas como Low_Coverage_Zone, THE Backend SHALL marcar como Low_Coverage_Zone toda unidad cuyo Coverage_Indicator sea mayor o igual al valor de `GEOSALUD_LOW_COVERAGE_THRESHOLD`.
4. IF la población INDEC para una unidad geográfica no está disponible, THEN THE Backend SHALL devolver el Coverage_Indicator como nulo y marcar la unidad con el estado `unknown_population`.

### Requirement 3: Vista tablero analítico

**User Story:** Como funcionario ministerial, quiero un tablero con mapa interactivo de CAPS e indicadores de cobertura, para tomar decisiones sobre asignación de recursos.

#### Acceptance Criteria

1. WHEN un usuario accede a la pestaña de tablero analítico, THE Frontend SHALL renderizar un mapa Leaflet centrado en la región configurada y mostrar un marcador por cada CAPS recibido del Backend.
2. WHEN el usuario selecciona un marcador de CAPS en el mapa, THE Frontend SHALL mostrar nombre del establecimiento, dirección, prestaciones declaradas y datos de capacidad provistos por el Capacity_Provider, indicando explícitamente el origen de los datos de capacidad.
3. THE Frontend SHALL renderizar una capa visual que distinga las Low_Coverage_Zone del resto de unidades geográficas usando un color diferenciado.
4. THE Frontend SHALL mostrar un panel con los siguientes indicadores agregados de la región: cantidad total de CAPS, población total estimada, Coverage_Indicator promedio y cantidad de Low_Coverage_Zone.
5. WHERE los datos de capacidad provienen del Mock_Capacity_Provider, THE Frontend SHALL mostrar la etiqueta visible "datos simulados" junto a cada valor de capacidad.
6. WHEN el Backend devuelve un error al solicitar datos del tablero, THE Frontend SHALL mostrar un mensaje de error legible al usuario sin exponer detalles internos del backend.

### Requirement 4: Vista de flujo de derivación

**User Story:** Como operador de salud, quiero ingresar la ubicación del paciente y su patología y obtener un ranking de CAPS recomendados, para derivar al paciente al centro más conveniente.

#### Acceptance Criteria

1. THE Frontend SHALL ofrecer una vista de derivación con campos de entrada para ubicación del paciente (coordenadas o dirección) y patología o síntoma.
2. WHEN el operador envía una solicitud de derivación, THE Frontend SHALL invocar al endpoint POST de derivación del Backend enviando ubicación y patología, sin enviar nombre, documento ni teléfono del paciente.
3. WHEN el Backend recibe una solicitud de derivación con dirección textual, THE Georef_Client SHALL normalizar la dirección y obtener coordenadas (lat, lon) antes de invocar al Referral_Engine.
4. WHEN el Referral_Engine recibe una solicitud de derivación, THE Referral_Engine SHALL calcular la Haversine_Distance entre la ubicación del paciente y cada CAPS de la región configurada.
5. WHEN el Referral_Engine prepara el ranking, THE Referral_Engine SHALL filtrar los CAPS que declaran la prestación correspondiente a la patología recibida según el catálogo configurado en `GEOSALUD_PATHOLOGY_CATALOG_URI`.
6. WHEN el Referral_Engine ordena el ranking final, THE Referral_Engine SHALL ordenar los CAPS combinando Haversine_Distance, disponibilidad de capacidad reportada por Capacity_Provider y compatibilidad de prestación, usando los pesos definidos en `GEOSALUD_RANKING_WEIGHTS`.
7. THE Referral_Engine SHALL devolver como máximo la cantidad de CAPS indicada en `GEOSALUD_REFERRAL_MAX_RESULTS`, incluyendo para cada CAPS distancia en kilómetros, prestaciones compatibles y nivel de capacidad reportado.
8. WHEN el Frontend recibe el ranking, THE Frontend SHALL mostrar los CAPS sugeridos en una lista ordenada y resaltarlos en el mapa Leaflet, junto con la ubicación del paciente.
9. IF la patología enviada no existe en el catálogo configurado, THEN THE Backend SHALL devolver un error 400 con código `unknown_pathology` y THE Frontend SHALL mostrar un mensaje al operador indicando que la patología no es reconocida.
10. IF ningún CAPS de la región declara la prestación requerida, THEN THE Backend SHALL devolver un ranking vacío con el código `no_caps_available` y THE Frontend SHALL mostrar un mensaje informativo al operador.

### Requirement 5: Interfaz Capacity_Provider con mock por defecto

**User Story:** Como equipo de desarrollo, quiero una interfaz abstracta de capacidad operativa con una implementación mock cargable por configuración, para integrar en el futuro una API ministerial real sin reescribir el backend.

#### Acceptance Criteria

1. THE Backend SHALL definir una interfaz Capacity_Provider con operaciones para obtener capacidad operativa, insumos y tiempos de espera dado un identificador de CAPS.
2. WHERE la variable de entorno `GEOSALUD_CAPACITY_PROVIDER` tiene el valor `mock`, THE Backend SHALL instanciar Mock_Capacity_Provider como implementación activa.
3. WHERE la variable de entorno `GEOSALUD_CAPACITY_PROVIDER` tiene el valor `ministry_api`, THE Backend SHALL instanciar Ministry_API_Capacity_Provider como implementación activa.
4. WHEN el Backend inicia con `GEOSALUD_CAPACITY_PROVIDER=mock`, THE Mock_Capacity_Provider SHALL leer los datos simulados desde la ruta indicada por `GEOSALUD_CAPACITY_MOCK_URI` en formato CSV o JSON.
5. WHEN cualquier respuesta del Backend incluye datos producidos por Mock_Capacity_Provider, THE Backend SHALL marcar el campo `capacity_source` con el valor `mock` para que el Frontend pueda etiquetar los datos como simulados.
6. IF la variable `GEOSALUD_CAPACITY_PROVIDER` tiene un valor no soportado, THEN THE Backend SHALL fallar el arranque con un error de configuración explícito.
7. IF Mock_Capacity_Provider no encuentra datos para un CAPS solicitado, THEN THE Mock_Capacity_Provider SHALL devolver un objeto con capacidad desconocida y campo `availability` igual a `unknown`.
8. THE Ministry_API_Capacity_Provider SHALL exponer la misma firma que Mock_Capacity_Provider y, mientras no esté implementada la integración real, devolver una respuesta `not_implemented` sin afectar el resto del backend.

### Requirement 6: Backend serverless en AWS con IaC

**User Story:** Como equipo de plataforma, quiero el backend desplegado como funciones Lambda detrás de API Gateway con infraestructura como código, para asegurar reproducibilidad y operación serverless.

#### Acceptance Criteria

1. THE Backend SHALL implementarse en Python siguiendo PEP 8, type hints obligatorios y formateo con black y ruff.
2. THE Backend SHALL desplegarse exclusivamente como funciones AWS Lambda expuestas mediante AWS API Gateway.
3. THE Backend SHALL definir toda su infraestructura usando AWS CDK o Terraform, sin recursos creados manualmente desde la consola de AWS.
4. THE Backend SHALL nombrar los recursos AWS siguiendo el patrón `geosalud-{ambiente}-{recurso}` y aplicar los tags `Project`, `Environment`, `Owner` y `CostCenter` a todos los recursos creados.
5. THE Backend SHALL exponer todos sus endpoints sobre HTTPS con TLS 1.2 o superior.
6. WHERE el Backend requiera credenciales para integraciones externas, THE Backend SHALL leerlas desde AWS Secrets Manager y nunca desde código fuente o variables de entorno en texto plano.
7. THE Backend SHALL emitir logs y métricas a CloudWatch, configurando alarmas para errores 5xx y latencia anómala en API Gateway.

### Requirement 7: Frontend React + Leaflet

**User Story:** Como usuario final, quiero una aplicación web única con dos vistas mediante tabs, para alternar entre tablero y derivación sin cambiar de aplicación.

#### Acceptance Criteria

1. THE Frontend SHALL implementarse en React con TypeScript en modo strict, ESLint y Prettier configurados.
2. THE Frontend SHALL ofrecer una sola aplicación con dos vistas seleccionables mediante tabs: Analytics_View y Referral_View.
3. WHERE la variable de entorno `GEOSALUD_ROLE_TABS_ENABLED` tiene el valor `true`, THE Frontend SHALL mostrar u ocultar las tabs Analytics_View y Referral_View según el rol del usuario autenticado.
4. THE Frontend SHALL renderizar todos los mapas usando Leaflet.js como librería de mapas.
5. THE Frontend SHALL leer la URL del Backend desde la variable de entorno `GEOSALUD_API_BASE_URL` y nunca desde valores hardcodeados.
6. THE Frontend SHALL comunicarse con el Backend exclusivamente sobre HTTPS.

### Requirement 8: Manejo seguro de datos del paciente

**User Story:** Como responsable de seguridad y cumplimiento, quiero que GeoSalud no persista ni logee datos personales del paciente, para cumplir las reglas de protección de datos.

#### Acceptance Criteria

1. THE Backend SHALL tratar los Patient_Input como datos transitorios y procesarlos únicamente en memoria durante el ciclo de vida de la solicitud.
2. THE Backend SHALL persistir cero campos de PII en cualquier almacenamiento (S3, DynamoDB, base relacional, archivos locales o caches).
3. WHEN el Backend escribe logs en CloudWatch, THE Backend SHALL omitir nombre, documento, teléfono, dirección exacta y cualquier otro campo PII del paciente.
4. WHEN el Backend necesita registrar una solicitud de derivación para métricas, THE Backend SHALL usar un identificador opaco generado por solicitud y registrar únicamente categorías agregadas (patología, unidad geográfica) sin PII.
5. THE Frontend SHALL evitar persistir Patient_Input en localStorage, sessionStorage, cookies o cualquier almacenamiento del navegador más allá de la sesión activa de la pantalla.
6. IF el Backend detecta un campo identificado como PII en el cuerpo de una solicitud, THEN THE Backend SHALL rechazar la solicitud con código 400 y mensaje `pii_not_allowed`.

### Requirement 9: Configuración por variables de entorno

**User Story:** Como operador de despliegue, quiero que toda la configuración esté en variables de entorno, para promover el sistema entre ambientes sin modificar código.

#### Acceptance Criteria

1. THE Backend SHALL leer todas sus configuraciones (URLs de datasets, región, proveedor de capacidad, umbrales, pesos de ranking, límites) desde variables de entorno y nunca desde valores hardcodeados.
2. THE Frontend SHALL leer la URL del Backend y los flags de funcionalidades desde variables de entorno disponibles en tiempo de build o runtime.
3. WHEN el Backend arranca, THE Backend SHALL validar la presencia de las variables obligatorias `GEOSALUD_REGION_CODE`, `GEOSALUD_REFES_DATASET_URL`, `GEOSALUD_INDEC_DATASET_URI`, `GEOSALUD_CAPACITY_PROVIDER`, `GEOSALUD_PATHOLOGY_CATALOG_URI` y `GEOSALUD_API_BASE_URL`, fallando con error explícito si alguna falta.
4. THE Backend SHALL aceptar el cambio de `GEOSALUD_REGION_CODE` para apuntar a otra provincia o municipio sin requerir cambios de código fuente.
5. THE Backend SHALL admitir que `GEOSALUD_REGION_CODE` reciba una lista de códigos para escalar a múltiples regiones o nivel nacional, sin cambios estructurales en el código de carga del REFES ni en los endpoints expuestos.
