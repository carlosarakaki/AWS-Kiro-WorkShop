# Requirements Document

## Introduction

GeoSalud es un **prototipo demostrable** de una aplicación web única, con dos vistas separadas por tabs y roles, que combina un tablero analítico georreferenciado para ministerios y una herramienta operativa de derivación a Centros de Atención Primaria de la Salud (CAPS). El objetivo del prototipo es exponer la idea de GeoSalud de forma navegable y verosímil, no producirla. La aplicación se entrega como una **página HTML auto-contenida** (HTML + CSS + JS, opcionalmente React empaquetado en un único bundle) que se sirve estática y se ejecuta 100% en el navegador, sin backend propio ni servicios cloud.

El sistema utiliza el dataset REFES (Registro Federal de Establecimientos de Salud) como fuente real de establecimientos. El dataset se obtiene previamente al desarrollo a través del MCP local `mcp-datos-abiertos-arg` (que ya existe en este repositorio y consume el portal datos.gob.ar) y se persiste como un archivo JSON estático que la página carga vía `fetch` local. Los datos de población INDEC necesarios para indicadores de cobertura se proveen como mock embebido en el bundle. La capacidad operativa, los insumos y los tiempos de espera de cada CAPS se modelan con un dataset simulado embebido (objeto JS o archivo JSON estático), expuesto a través de una interfaz JavaScript abstracta que permita reemplazar la fuente por una API real en el futuro.

Para persistencia local del usuario (favoritos, configuración personal, historial de derivaciones simuladas) se usa **`localStorage` del navegador**, nunca para datos del paciente. El alcance geográfico se limita a una provincia o municipio configurable mediante un objeto de configuración JS al tope del bundle o vía query params de la URL. La normalización geográfica usa la API pública Georef de Argentina invocada directamente desde el navegador (cuando el dataset estático no trae los datos administrativos ya normalizados). El cálculo de distancias se realiza en JavaScript con la fórmula Haversine. **No hay AWS, ni base de datos, ni Infraestructura como Código**: el prototipo se hospeda en cualquier hosting estático (incluyendo `file://` para demos locales).

## Glossary

- **GeoSalud**: Prototipo objeto de esta especificación.
- **Prototype_App**: Página HTML auto-contenida que implementa todo el sistema y corre 100% en el navegador.
- **Static_Bundle**: Conjunto mínimo de archivos servidos junto al HTML (JS, CSS, datasets JSON/CSV), sin dependencias de servidor dinámico.
- **MCP_Datos_Abiertos_Arg**: Servidor MCP local ubicado en `mcp-datos-abiertos-arg/` del repositorio, que expone tools para consultar el catálogo de datos.gob.ar.
- **REFES**: Registro Federal de Establecimientos de Salud, dataset oficial publicado en datos.salud.gob.ar / datos.gob.ar.
- **REFES_Static_File**: Archivo JSON estático generado offline a partir de los datos del REFES, cargado por la Prototype_App vía `fetch` local en el arranque.
- **REFES_Acquisition_Procedure**: Procedimiento documentado en el repositorio que describe cómo usar el MCP_Datos_Abiertos_Arg para descargar el REFES y producir el REFES_Static_File.
- **CAPS**: Centro de Atención Primaria de la Salud, tipo de establecimiento del REFES sobre el que opera GeoSalud.
- **Analytics_View**: Vista del tablero analítico con mapa de CAPS, indicadores de densidad y zonas de baja cobertura.
- **Referral_View**: Vista del flujo de derivación que recibe ubicación del paciente y patología, y devuelve ranking de CAPS.
- **Referral_Engine**: Módulo JavaScript que calcula el ranking de CAPS combinando distancia Haversine, capacidad y prestación.
- **Capacity_Provider**: Interfaz JavaScript abstracta (patrón Strategy) que entrega datos de capacidad operativa, insumos y tiempos de espera por CAPS.
- **Mock_Capacity_Provider**: Implementación por defecto de Capacity_Provider que lee un objeto JS embebido o un archivo JSON estático del Static_Bundle.
- **Future_API_Capacity_Provider**: Implementación stub de Capacity_Provider preparada para integrar una API real en el futuro, sin cambios estructurales.
- **Pathology_Catalog**: Catálogo de patologías y prestaciones requeridas, embebido en el Static_Bundle como objeto JS o archivo JSON.
- **Population_Mock_Dataset**: Dataset embebido con poblaciones por unidad geográfica basado en INDEC, usado para Coverage_Indicator.
- **Georef_API**: API pública del Estado argentino (`https://apis.datos.gob.ar/georef/api`) consumida desde el navegador para normalizar provincias, departamentos, municipios y localidades.
- **App_Config**: Objeto JavaScript declarado al tope del bundle (o derivado de query params de la URL) que centraliza toda la configuración del prototipo.
- **Region_Code**: Código de provincia o municipio configurado en la propiedad `regionCode` de App_Config o vía query param `region`.
- **Patient_Input**: Conjunto de datos transitorios provistos por el operador para una derivación: coordenadas o dirección del paciente y patología/síntoma.
- **PII**: Información personal identificable del paciente (nombre, documento, dirección exacta, teléfono, historia clínica).
- **Haversine_Distance**: Distancia geodésica calculada entre dos pares de coordenadas (lat, lon) usando la fórmula Haversine, implementada en JavaScript.
- **Coverage_Indicator**: Indicador de cobertura calculado como cantidad de habitantes por CAPS dentro de una unidad geográfica.
- **Low_Coverage_Zone**: Unidad geográfica cuyo Coverage_Indicator supera el umbral configurado en App_Config.
- **Local_Persistence**: Almacenamiento usado por la Prototype_App para favoritos, configuración personal e historial simulado de derivaciones, materializado en `window.localStorage`.

## Requirements

### Requirement 1: Prototipo como página HTML auto-contenida

**User Story:** Como facilitador del jornada, quiero que GeoSalud sea una página HTML que se sirva como archivo estático, para demostrar la idea sin desplegar infraestructura.

#### Acceptance Criteria

1. THE Prototype_App SHALL implementarse como un único proyecto que se sirve estático y produce un Static_Bundle compuesto por el archivo HTML principal, los assets JS/CSS y los datasets JSON necesarios.
2. THE Prototype_App SHALL ejecutarse íntegramente en el navegador del usuario sin requerir un backend propio, base de datos ni servicios cloud.
3. THE Prototype_App SHALL funcionar al abrirse desde un servidor de archivos estáticos (HTTP local, hosting estático o `file://` cuando el navegador lo permita) sin pasos adicionales de configuración cloud.
4. WHEN la Prototype_App arranca, THE Prototype_App SHALL renderizar la interfaz inicial sin requerir credenciales, login ni acceso a servicios externos pagos.
5. THE Prototype_App SHALL declarar en su `README` los comandos para servir el bundle de forma estática y la lista de archivos que componen el Static_Bundle.

### Requirement 2: Obtención del dataset REFES vía MCP

**User Story:** Como desarrollador, quiero obtener el dataset REFES desde el MCP local `mcp-datos-abiertos-arg` y dejarlo como archivo estático, para que la Prototype_App lo consuma sin depender de internet en demo.

#### Acceptance Criteria

1. THE Repositorio SHALL incluir un REFES_Acquisition_Procedure documentado que describa, paso a paso, cómo invocar las tools del MCP_Datos_Abiertos_Arg (`search_datasets`, `get_dataset_info`, `list_dataset_resources`, `query_resource_data`) para localizar el dataset REFES y exportarlo a formato JSON.
2. THE REFES_Acquisition_Procedure SHALL producir como salida un archivo REFES_Static_File con extensión `.json` ubicado en una ruta del Static_Bundle declarada en App_Config bajo la propiedad `refesStaticPath`.
3. WHEN el REFES_Acquisition_Procedure transforma el dataset, THE REFES_Acquisition_Procedure SHALL conservar únicamente los establecimientos clasificados como CAPS según el campo de tipología del REFES.
4. WHEN el REFES_Acquisition_Procedure transforma el dataset, THE REFES_Acquisition_Procedure SHALL filtrar los registros por la propiedad `regionCode` de App_Config y descartar registros con coordenadas inválidas (latitud o longitud nula, fuera del rango [-90, 90] o [-180, 180]).
5. WHEN el REFES_Acquisition_Procedure normaliza geografía, THE REFES_Acquisition_Procedure SHALL invocar la Georef_API de Argentina para enriquecer cada registro con identificadores y nombres canónicos de provincia, departamento, municipio y localidad antes de escribir el REFES_Static_File.
6. THE REFES_Acquisition_Procedure SHALL ser reproducible mediante un script (Python o Node) versionado en el repositorio que pueda regenerar el REFES_Static_File a demanda.

### Requirement 3: Carga del REFES en el navegador

**User Story:** Como usuario del prototipo, quiero que la página cargue automáticamente los CAPS al abrirse, para ver el mapa con datos reales sin pasos manuales.

#### Acceptance Criteria

1. WHEN la Prototype_App arranca, THE Prototype_App SHALL solicitar el REFES_Static_File mediante una llamada `fetch` a la ruta declarada en `App_Config.refesStaticPath`.
2. WHEN la Prototype_App recibe el REFES_Static_File, THE Prototype_App SHALL parsear el JSON, validar que cada registro tenga coordenadas dentro de los rangos permitidos y descartar registros inválidos sin interrumpir el arranque.
3. IF la carga del REFES_Static_File falla por error de red o JSON malformado, THEN THE Prototype_App SHALL mostrar un mensaje de error legible al usuario indicando que el dataset no pudo cargarse y registrar el detalle técnico solo en `console.error` del navegador.
4. THE Prototype_App SHALL exponer en una variable de estado en memoria los CAPS cargados para uso de Analytics_View y Referral_View, sin escribir el dataset a Local_Persistence.

### Requirement 4: Indicadores de densidad poblacional por CAPS

**User Story:** Como ministerio, quiero ver indicadores de densidad de habitantes por CAPS en el prototipo, para detectar zonas con cobertura insuficiente.

#### Acceptance Criteria

1. THE Prototype_App SHALL incluir un Population_Mock_Dataset embebido en el Static_Bundle (objeto JS o archivo JSON) con población estimada por unidad geográfica, basado en datos INDEC.
2. WHEN la Prototype_App calcula el Coverage_Indicator de una unidad geográfica, THE Prototype_App SHALL dividir la población estimada por la cantidad de CAPS de la unidad usando los valores del Population_Mock_Dataset.
3. WHEN la Prototype_App identifica unidades geográficas como Low_Coverage_Zone, THE Prototype_App SHALL marcar como Low_Coverage_Zone toda unidad cuyo Coverage_Indicator sea mayor o igual al valor de `App_Config.lowCoverageThreshold`.
4. IF la población para una unidad geográfica no está en el Population_Mock_Dataset, THEN THE Prototype_App SHALL devolver el Coverage_Indicator como nulo y marcar la unidad con el estado `unknown_population`.

### Requirement 5: Vista tablero analítico

**User Story:** Como funcionario ministerial, quiero un tablero con mapa interactivo de CAPS e indicadores de cobertura, para tomar decisiones sobre asignación de recursos.

#### Acceptance Criteria

1. WHEN un usuario accede a la pestaña Analytics_View, THE Prototype_App SHALL renderizar un mapa Leaflet centrado en la región configurada en App_Config y mostrar un marcador por cada CAPS cargado en memoria.
2. WHEN el usuario selecciona un marcador de CAPS en el mapa, THE Prototype_App SHALL mostrar nombre del establecimiento, dirección, prestaciones declaradas y los datos de capacidad provistos por el Capacity_Provider activo, indicando explícitamente el origen de los datos de capacidad.
3. THE Prototype_App SHALL renderizar una capa visual que distinga las Low_Coverage_Zone del resto de unidades geográficas usando un color diferenciado.
4. THE Prototype_App SHALL mostrar un panel con los siguientes indicadores agregados de la región: cantidad total de CAPS, población total estimada, Coverage_Indicator promedio y cantidad de Low_Coverage_Zone.
5. WHERE los datos de capacidad provienen del Mock_Capacity_Provider, THE Prototype_App SHALL mostrar la etiqueta visible "datos simulados" junto a cada valor de capacidad.
6. WHERE el usuario marca un CAPS como favorito en Analytics_View, THE Prototype_App SHALL persistir el identificador del CAPS favorito en Local_Persistence bajo la clave `geosalud:favorites` y restaurarlo en la siguiente carga de la página.

### Requirement 6: Vista de flujo de derivación

**User Story:** Como operador de salud, quiero ingresar la ubicación del paciente y su patología y obtener un ranking de CAPS recomendados, para derivar al paciente al centro más conveniente.

#### Acceptance Criteria

1. THE Prototype_App SHALL ofrecer una Referral_View con campos de entrada para ubicación del paciente (coordenadas o dirección) y patología o síntoma.
2. WHEN el operador envía una solicitud de derivación, THE Prototype_App SHALL construir el payload de cálculo conservando únicamente la ubicación y la patología, descartando explícitamente cualquier campo de PII (nombre, documento, teléfono, email, historia clínica).
3. WHEN la Referral_View recibe una dirección textual, THE Prototype_App SHALL invocar la Georef_API directamente desde el navegador para obtener coordenadas (lat, lon) antes de delegar el cálculo al Referral_Engine.
4. WHEN el Referral_Engine recibe una solicitud de derivación, THE Referral_Engine SHALL calcular la Haversine_Distance entre la ubicación del paciente y cada CAPS de la región configurada usando la implementación JavaScript embebida en el bundle.
5. WHEN el Referral_Engine prepara el ranking, THE Referral_Engine SHALL filtrar los CAPS que declaran la prestación correspondiente a la patología recibida según el Pathology_Catalog declarado en `App_Config.pathologyCatalogPath`.
6. WHEN el Referral_Engine ordena el ranking final, THE Referral_Engine SHALL ordenar los CAPS combinando Haversine_Distance, disponibilidad de capacidad reportada por Capacity_Provider y compatibilidad de prestación, usando los pesos definidos en `App_Config.rankingWeights`.
7. THE Referral_Engine SHALL devolver como máximo la cantidad de CAPS indicada en `App_Config.referralMaxResults`, incluyendo para cada CAPS distancia en kilómetros, prestaciones compatibles y nivel de capacidad reportado.
8. WHEN la Prototype_App recibe el ranking, THE Prototype_App SHALL mostrar los CAPS sugeridos en una lista ordenada y resaltarlos en el mapa Leaflet, junto con la ubicación del paciente.
9. IF la patología enviada no existe en el Pathology_Catalog, THEN THE Prototype_App SHALL mostrar un mensaje al operador indicando que la patología no es reconocida sin invocar al Referral_Engine.
10. IF ningún CAPS de la región declara la prestación requerida, THEN THE Prototype_App SHALL mostrar un mensaje informativo al operador con el código `no_caps_available` y un ranking vacío.
11. WHERE el usuario completa una derivación simulada, THE Prototype_App SHALL anexar una entrada al historial almacenado en Local_Persistence bajo la clave `geosalud:referralHistory` que contenga únicamente identificadores opacos, código de patología, distancia, ranking de `caps_id` y timestamp, sin ningún campo de PII.

### Requirement 7: Interfaz Capacity_Provider con mock por defecto

**User Story:** Como equipo de desarrollo, quiero una interfaz JavaScript abstracta de capacidad operativa con una implementación mock cargable por configuración, para integrar en el futuro una API real sin reescribir el prototipo.

#### Acceptance Criteria

1. THE Prototype_App SHALL definir una interfaz JavaScript Capacity_Provider con operaciones para obtener capacidad operativa, insumos y tiempos de espera dado un identificador de CAPS.
2. WHERE la propiedad `App_Config.capacityProvider` tiene el valor `mock`, THE Prototype_App SHALL instanciar Mock_Capacity_Provider como implementación activa.
3. WHERE la propiedad `App_Config.capacityProvider` tiene el valor `future_api`, THE Prototype_App SHALL instanciar Future_API_Capacity_Provider como implementación activa.
4. WHEN la Prototype_App inicia con `App_Config.capacityProvider = "mock"`, THE Mock_Capacity_Provider SHALL leer los datos simulados desde un objeto JS embebido en el bundle o desde el archivo declarado en `App_Config.capacityMockPath` en formato JSON o CSV.
5. WHEN cualquier respuesta del Referral_Engine o Analytics_View incluye datos producidos por Mock_Capacity_Provider, THE Prototype_App SHALL marcar el campo `capacitySource` con el valor `mock` para que la UI pueda etiquetar los datos como simulados.
6. IF la propiedad `App_Config.capacityProvider` tiene un valor no soportado, THEN THE Prototype_App SHALL fallar el arranque con un error de configuración explícito visible en la UI y en `console.error`.
7. IF Mock_Capacity_Provider no encuentra datos para un CAPS solicitado, THEN THE Mock_Capacity_Provider SHALL devolver un objeto con capacidad desconocida y campo `availability` igual a `unknown`.
8. THE Future_API_Capacity_Provider SHALL exponer la misma firma que Mock_Capacity_Provider y, mientras no esté implementada la integración real, devolver una respuesta `not_implemented` sin afectar el resto de la Prototype_App.

### Requirement 8: Frontend con Leaflet en una sola página

**User Story:** Como usuario final, quiero una aplicación web única con dos vistas mediante tabs, para alternar entre tablero y derivación sin cambiar de aplicación.

#### Acceptance Criteria

1. THE Prototype_App SHALL implementarse en JavaScript moderno (ES2020+) o TypeScript en modo strict, empaquetado en el Static_Bundle.
2. THE Prototype_App SHALL ofrecer una sola interfaz con dos vistas seleccionables mediante tabs: Analytics_View y Referral_View.
3. WHERE la propiedad `App_Config.roleTabsEnabled` tiene el valor `true`, THE Prototype_App SHALL mostrar u ocultar las tabs Analytics_View y Referral_View según el rol declarado en `App_Config.role` o en el query param `role`.
4. THE Prototype_App SHALL renderizar todos los mapas usando Leaflet.js como librería de mapas, cargada desde el Static_Bundle o desde un CDN público declarado en App_Config.
5. THE Prototype_App SHALL invocar la Georef_API exclusivamente sobre HTTPS y mostrar al usuario un mensaje neutral si la API responde con un error o no está disponible.

### Requirement 9: Manejo seguro de datos del paciente en el navegador

**User Story:** Como responsable de seguridad y cumplimiento, quiero que GeoSalud no persista ni logee datos personales del paciente en el navegador, para cumplir las reglas de protección de datos.

#### Acceptance Criteria

1. THE Prototype_App SHALL tratar los Patient_Input como datos transitorios y mantenerlos únicamente en variables locales del componente activo durante la sesión de la pantalla.
2. THE Prototype_App SHALL persistir cero campos de PII en Local_Persistence (`localStorage`, `sessionStorage`, IndexedDB ni cookies).
3. WHEN la Prototype_App escribe en `console.log`, `console.warn` o `console.error`, THE Prototype_App SHALL omitir nombre, documento, teléfono, dirección exacta y cualquier otro campo PII del paciente.
4. WHEN la Prototype_App registra una derivación simulada en el historial local, THE Prototype_App SHALL usar un identificador opaco generado por solicitud y registrar únicamente categorías agregadas (patología, unidad geográfica, distancia, timestamp) sin PII.
5. IF la Prototype_App detecta un campo identificado como PII en el formulario de Referral_View antes de llamar al Referral_Engine, THEN THE Prototype_App SHALL rechazar la solicitud con un mensaje neutral y código `pii_not_allowed` sin invocar Georef_API ni registrar el contenido del campo.
6. WHEN el componente de Referral_View se desmonta o el usuario navega a otra tab, THE Prototype_App SHALL limpiar los Patient_Input retenidos en estado de la vista.

### Requirement 10: Configuración por objeto JS o query params

**User Story:** Como operador de despliegue del prototipo, quiero ajustar la configuración editando un objeto JS al tope del bundle o pasando query params, para adaptar el prototipo a otra región sin tocar código profundo.

#### Acceptance Criteria

1. THE Prototype_App SHALL declarar un objeto JavaScript App_Config en una ubicación claramente identificada del bundle (por ejemplo, archivo `config.js` o variable global en el HTML) que centralice todas las propiedades de configuración del prototipo.
2. THE App_Config SHALL incluir las propiedades `regionCode`, `refesStaticPath`, `pathologyCatalogPath`, `capacityProvider`, `capacityMockPath`, `lowCoverageThreshold`, `rankingWeights`, `referralMaxResults`, `roleTabsEnabled` y `georefApiBaseUrl`.
3. WHEN la Prototype_App arranca, THE Prototype_App SHALL leer los query params de la URL y permitir que sobreescriban las propiedades equivalentes de App_Config (por ejemplo, `?region=06` reemplaza `regionCode`).
4. WHEN la Prototype_App valida la configuración, THE Prototype_App SHALL fallar el arranque con un mensaje explícito si `regionCode`, `refesStaticPath`, `pathologyCatalogPath` o `capacityProvider` no están definidos.
5. THE App_Config SHALL admitir que `regionCode` reciba una lista de códigos para escalar a múltiples regiones, sin cambios estructurales en el código de carga del REFES ni en el Referral_Engine.
6. THE Prototype_App SHALL evitar valores hardcodeados de URLs, paths o umbrales fuera de App_Config.
