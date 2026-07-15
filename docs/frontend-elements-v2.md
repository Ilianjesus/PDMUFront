# Preparación frontend para `pdmu-elements v2`

Estado: implementado como integración opt-in; legacy sigue siendo el modo predeterminado.  
Fecha: 29 de junio de 2026.

## Alcance

React puede consumir las lecturas `element.search` y `element.get` del contrato n8n v2 sin consultar directamente tablas Supabase. Solo `element.search` está conectado al buscador público; `element.get` queda como adaptador preparado para una migración posterior del Panel Administrativo.

No se modificaron endpoints, payloads ni workflows legacy de inscripciones, pagos, asistencias o administración.

## Variables de entorno

```env
VITE_N8N_ELEMENTS_V2_URL=
VITE_USE_ELEMENTS_V2=false
```

Las variables `VITE_*` son visibles en el navegador. La URL no es un secreto ni debe considerarse un control de acceso. Nunca colocar `service_role`, secretos de n8n o claves privadas en estas variables.

### Activar v2

Configurar en el entorno local/despliegue y reiniciar Vite:

```env
VITE_N8N_ELEMENTS_V2_URL=https://endpoint-de-desarrollo.example.invalid/pdmu-elements
VITE_USE_ELEMENTS_V2=true
```

V2 solo se usa cuando el flag equivale a `true` y la URL es HTTP/HTTPS válida. Si falta cualquiera, `searchElements` conserva el GET legacy.

### Volver a legacy

```env
VITE_USE_ELEMENTS_V2=false
```

No es necesario borrar la URL. El cambio requiere un nuevo build/reinicio porque Vite incorpora estas variables al bundle.

## Selección de implementación

```text
searchElements(options)
        │
        ├─ flag=true + URL válida ──> element.search v2 (POST)
        │
        └─ cualquier otra config ───> búsqueda legacy (GET)
```

La selección es exclusivamente por configuración. Si v2 fue activado y devuelve timeout, error de red, error n8n, acción incorrecta o contrato inválido, el error se presenta al usuario. No se reintenta silenciosamente contra legacy porque ocultaría problemas durante la migración.

## Cliente v2

`src/services/workflows/v2/workflowClient.js`:

- envía `POST application/json`;
- genera `X-Request-Id` UUID por intento;
- construye `{ contractVersion: "2.0", action, data }`;
- aplica timeout mediante el cliente HTTP común;
- valida `ok`, `requestId`, `action`, `data/error` y metadata;
- rechaza respuestas correspondientes a otra acción;
- normaliza errores al shape interno `{ ok, code, message, raw }` y conserva `fieldErrors`, `retryable`, `requestId`, `status` y `meta` cuando existen;
- no envía `Idempotency-Key`, porque search/get son lecturas;
- no adjunta `Authorization` todavía.

Existe un único punto de extensión `INCLUDE_ACCESS_TOKEN` junto al cliente. No debe activarse hasta que n8n valide firma, issuer, audience, expiración y permisos del JWT de Supabase.

## `element.search`

Uso:

```js
searchElementsV2({ query, limit: 20, cursor: null });
```

Request externo:

```json
{
  "contractVersion": "2.0",
  "action": "element.search",
  "data": {
    "query": "prueba",
    "status": "active",
    "page": { "limit": 20, "cursor": null }
  }
}
```

El adaptador convierte cada resultado v2 al modelo que ya consumen `Buscador`, Registrar Pago y Panel Admin:

| v2 | Modelo interno compatible |
|---|---|
| `elementId` | `ID` |
| `displayName` | `displayName`; también `Nombre` si no existe `name` estructurado |
| `name.givenNames` | `Nombre` y `Nombres` |
| `name.paternalSurname` | `ApellidoPaterno` |
| `name.maternalSurname` | `ApellidoMaterno` |
| `groupCode` | `groupCode` |
| `status` | `status` |

`elementId` se conserva como string opaco. React no asume si es `element_code`, UUID u otro formato.

En legacy, el buscador continúa filtrando localmente la lista completa e incluye ahora el `ID` en el texto buscable. En v2 usa directamente los resultados filtrados por n8n para no descartar coincidencias server-side. La primera consulta v2 está limitada a 20 resultados; paginación/infinite scroll queda pendiente.

## `element.get`

Uso preparado, todavía no conectado al Panel Admin:

```js
getElementV2({
  elementId,
  include: ["profile", "documents", "assets"],
});
```

El adaptador produce campos compatibles con el módulo de información:

- `ID`, `Nombre`, `Nombres`, `ApellidoPaterno`, `ApellidoMaterno`.
- `FechaNacimiento`, `Sexo`, `Grupo`, `Enfermedades`.
- `Tutor`, `TelefonoTutor`, `status`, `version` y timestamps.
- `documents` y `assets` sin perder el DTO v2.
- Tipos documentales conocidos también se proyectan a `ineTutor`, `certificadoMedico`, `comprobanteDomicilio`, `actaNacimiento`, `curp` y `hojaInscripcion`.

Esto no migra lectura, edición ni carga documental del panel. `readAdminModule`, updates y uploads siguen usando sus contratos legacy.

## Validación con fixtures

Sin agregar un framework ni dependencias nuevas:

```bash
npm run validate:elements-v2
```

Valida cinco escenarios contra `docs/fixtures/elements-v2/`:

- búsqueda exitosa;
- búsqueda vacía;
- expediente exitoso;
- `VALIDATION_ERROR`;
- `NOT_FOUND`.

Resultado esperado:

```text
elements_v2_fixture_validation | PASS | 5 scenarios
```

## Prueba con n8n de desarrollo

1. Desplegar un workflow v2 independiente; no reemplazar el webhook legacy.
2. Probar los fixtures directamente contra n8n y confirmar status HTTP/envelopes.
3. Confirmar que n8n usa credencial Supabase server-side y nunca la devuelve.
4. Configurar URL y flag únicamente en un despliegue frontend de desarrollo.
5. Buscar `PDMU-SEED-001`, un nombre conocido y una búsqueda vacía.
6. Forzar un error de contrato y comprobar que aparece; no debe caer a legacy.
7. Desactivar el flag y comprobar que vuelve el GET legacy.
8. Verificar Registrar Pago y Panel Admin seleccionando un elemento; sus operaciones posteriores deben continuar en legacy.

## Pendientes del lado n8n

- Implementar endpoint independiente para `element.search` y `element.get`.
- Validar requests, límites, cursores y allowlist de `include`.
- Responder exactamente el envelope v2 y devolver la misma acción solicitada.
- Generar/validar `requestId` y usar consultas Supabase parametrizadas.
- Mantener credenciales server-side fuera de execution data y logs.
- Aplicar autorización y redacción de datos sensibles en `element.get`.
- Antes de activar Bearer en React, validar JWT Supabase y permisos de operador server-side.

## Limitaciones deliberadas

- `element.get` no está conectado al panel.
- No existe paginación visual del buscador.
- No hay fallback automático por errores v2.
- No se adjunta access token.
- No se escriben datos mediante v2.
- Los endpoints legacy siguen siendo necesarios para todas las operaciones activas restantes.
