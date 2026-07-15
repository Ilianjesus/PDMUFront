# Implementación propuesta de `pdmu-elements v2`

Estado: diseño listo para implementación; React y n8n todavía no fueron modificados.  
Fecha: 29 de junio de 2026.

## 1. Objetivo y límites

La primera entrega de `pdmu-elements v2` debe mover únicamente dos lecturas a Supabase:

- `element.search`: buscar elementos sin exponer el expediente completo.
- `element.get`: consultar el expediente de un elemento autorizado.

n8n continúa como frontera backend. React no consulta las tablas de negocio de Supabase, no recibe credenciales server-side y mantiene el buscador legacy hasta que v2 pase sus pruebas. Esta fase no incluye altas, actualizaciones, documentos, pagos ni asistencias.

El contrato base es el definido en `docs/contratos-n8n-v2.md`. Los ejemplos ejecutables están en `docs/fixtures/elements-v2/`.

## 2. Identificadores

- `elements.id` es el UUID interno y se usa en joins, pero no se expone en v2.
- `elements.element_code` se devuelve como `elementId` público durante la transición.
- n8n resuelve `elementId -> elements.id` dentro de la operación.
- React trata `elementId` como string opaco: no valida si es código legado o UUID.

Esta separación permite cambiar más adelante el identificador público sin alterar las pantallas ni las relaciones internas.

## 3. Endpoint y transporte

Un endpoint HTTPS de desarrollo de `pdmu-elements` recibe ambas acciones mediante `POST` JSON. Su URL no forma parte de este documento ni debe hardcodearse.

Headers previstos cuando se implemente la seguridad v2:

```http
Content-Type: application/json
Authorization: Bearer <supabase_access_token>
X-Request-Id: <uuid-opcional-generado-por-el-cliente>
```

El workflow debe validar el JWT, no solo decodificarlo. La ausencia o invalidez de sesión responde `401`; un operador sin permiso responde `403`.

## 4. Contrato `element.search`

### Request exacto

```json
{
  "contractVersion": "2.0",
  "action": "element.search",
  "data": {
    "query": "prueba",
    "status": "active",
    "page": {
      "limit": 20,
      "cursor": null
    }
  }
}
```

Reglas de entrada:

- El body debe ser un objeto JSON y no un array.
- `contractVersion` debe ser exactamente `2.0`.
- `action` debe ser exactamente `element.search`.
- `data.query`: string, `trim`, entre 2 y 100 caracteres.
- `data.status`: opcional; allowlist `active`, `inactive`, `archived`. Inicialmente se recomienda `active` por defecto.
- `data.page.limit`: entero entre 1 y 50; default 20.
- `data.page.cursor`: `null` o cursor opaco emitido por el servidor. Un cursor inválido es `VALIDATION_ERROR`.
- Rechazar tipos incorrectos y campos sensibles/no soportados; nunca interpolar valores en SQL.

### Response `200`

```json
{
  "ok": true,
  "requestId": "018f5f86-42b2-7a14-9f29-c78a10264d88",
  "action": "element.search",
  "data": {
    "items": [
      {
        "elementId": "PDMU-SEED-001",
        "displayName": "Elemento Prueba Supabase",
        "groupCode": "SEED",
        "status": "active"
      }
    ]
  },
  "meta": {
    "contractVersion": "2.0",
    "processedAt": "2026-06-29T18:30:00.000Z",
    "pagination": {
      "limit": 20,
      "nextCursor": null,
      "hasMore": false
    }
  }
}
```

Una búsqueda sin coincidencias es éxito con `items: []`; no es `NOT_FOUND` ni error de red.

### SQL recomendado

Usar parámetros del driver/nodo y escapar `%`, `_` y `\` si el término se convierte en patrón `ILIKE`. La siguiente forma expresa la intención; los placeholders deben adaptarse al conector real sin concatenar valores:

```sql
select
  e.id as internal_id,
  e.element_code,
  concat_ws(
    ' ',
    e.given_names,
    e.paternal_surname,
    nullif(e.maternal_surname, '')
  ) as display_name,
  e.group_code,
  e.status,
  lower(e.paternal_surname) as sort_paternal,
  lower(coalesce(e.maternal_surname, '')) as sort_maternal,
  lower(e.given_names) as sort_given
from public.elements e
where e.status = $1
  and (
    lower(btrim(e.element_code)) = lower(btrim($2))
    or e.given_names ilike $3 escape '\'
    or e.paternal_surname ilike $3 escape '\'
    or coalesce(e.maternal_surname, '') ilike $3 escape '\'
  )
  and (
    $4::text is null
    or (
      lower(e.paternal_surname),
      lower(coalesce(e.maternal_surname, '')),
      lower(e.given_names),
      e.id
    ) > ($4, $5, $6, $7::uuid)
  )
order by
  lower(e.paternal_surname),
  lower(coalesce(e.maternal_surname, '')),
  lower(e.given_names),
  e.id
limit $8;
```

- `$3` es el patrón literal escapado y rodeado con `%` por código server-side.
- `$4..$7` provienen de un cursor validado; nunca de campos sueltos aceptados del cliente.
- `$8` es `limit + 1`. La fila adicional determina `hasMore` y no se devuelve.
- El cursor codifica el último tuple de orden, con versión de cursor; es opaco para React.
- `internal_id` solo sirve dentro del workflow y no se incluye en la respuesta.

Para búsquedas multivocabulario más flexibles se puede agregar después una función/RPC revisada. No conviene introducir SQL dinámico en el primer workflow.

## 5. Contrato `element.get`

### Request exacto

```json
{
  "contractVersion": "2.0",
  "action": "element.get",
  "data": {
    "elementId": "PDMU-SEED-001",
    "include": ["profile", "documents", "assets"]
  }
}
```

Reglas de entrada:

- `elementId`: string opaco, `trim`, entre 1 y 100 caracteres.
- `include`: array sin duplicados, formado solo por `profile`, `documents`, `assets`.
- `include` ausente puede equivaler a `["profile"]`; la decisión debe quedar fija en el workflow.
- Pagos y asistencias no pueden incluirse desde este endpoint.
- La visibilidad de `medicalNotes`, documentos y assets se decide server-side según el operador validado.

### Query del elemento

```sql
select
  e.id as internal_id,
  e.element_code,
  e.given_names,
  e.paternal_surname,
  e.maternal_surname,
  e.birth_date,
  e.sex_code,
  e.group_code,
  e.medical_notes,
  e.guardian_name,
  e.guardian_phone,
  e.qr_value,
  e.drive_folder_id,
  e.drive_folder_url,
  e.status,
  e.version,
  e.created_at,
  e.updated_at
from public.elements e
where lower(btrim(e.element_code)) = lower(btrim($1))
limit 1;
```

Si no hay fila, responder `404 NOT_FOUND`. El UUID `internal_id`, `drive_folder_id` y cualquier valor interno de QR no deben devolverse tal cual.

### Query de documentos

Se ejecuta solo cuando `include` contiene `documents` y después de obtener el UUID interno:

```sql
select
  d.id,
  d.document_type,
  d.original_filename,
  d.mime_type,
  d.size_bytes,
  d.uploaded_at,
  d.version,
  d.drive_file_id,
  d.drive_url
from public.element_documents d
where d.element_id = $1::uuid
  and d.status = 'active'
order by d.document_type, d.uploaded_at desc;
```

n8n debe transformar IDs y URLs de Drive en referencias autorizadas. Una URL permanente no debe exponerse si evita controles de acceso; `downloadUrl` debe ser temporal o provenir de un endpoint autorizado.

### Response `200`

El shape exacto está en `element.get.response.success.json`. Puntos obligatorios:

- `data.element.elementId` contiene `element_code`.
- `data.element` usa el modelo canónico de `contratos-n8n-v2.md`.
- `documents` y `assets` solo aparecen si fueron solicitados y autorizados.
- Fechas usan ISO 8601; `birthDate` usa `YYYY-MM-DD`.
- No se devuelven UUIDs internos, IDs internos de Drive ni campos fuera del contrato.

## 6. Errores estables

| HTTP | Código | Cuándo |
|---|---|---|
| 400/422 | `VALIDATION_ERROR` | Body, action, query, include, limit o cursor inválido. Usar 422 para datos bien formados que no cumplen el contrato. |
| 401 | `UNAUTHENTICATED` | JWT ausente, inválido o expirado. |
| 403 | `FORBIDDEN` | Operador autenticado sin permiso. |
| 404 | `NOT_FOUND` | `element.get` no encuentra un elemento visible. |
| 500 | `INTERNAL_ERROR` | Error no esperado del workflow o de la consulta. |

`INTERNAL_ERROR` no revela SQL, tablas, credenciales, stack traces ni payloads de Supabase. El texto visible es genérico; el detalle interno se correlaciona por `requestId`.

## 7. Generación de `requestId`

1. Leer `X-Request-Id` si existe.
2. Aceptarlo solo si es UUID válido; limitar su longitud.
3. Si falta o es inválido, generar un UUID con una fuente criptográficamente segura del runtime de n8n.
4. Reutilizarlo en respuesta, auditoría y logs de todos los nodos.

No usar timestamps, correos ni `elementId` como request ID.

## 8. Credencial server-side

- Guardar la credencial de Supabase únicamente en el almacén de credenciales de n8n o en el secret manager de la infraestructura.
- Nunca enviarla a React, usar prefijo `VITE_`, incluirla en fixtures, execution data, logs o documentación.
- Para v1, la migración concede al rol `service_role` solo los privilegios necesarios y bloquea DELETE físico en tablas de negocio.
- Preferir a futuro un rol PostgreSQL específico para n8n o funciones RPC de alcance mínimo; no ampliar grants por comodidad.
- Validar por separado el JWT del operador. La credencial de base identifica al backend, no al usuario final.

## 9. Validación y autorización en n8n

Orden recomendado del workflow:

1. Aceptar solo `POST` y limitar tamaño del body.
2. Crear/validar `requestId`.
3. Validar JWT Supabase (`iss`, `aud`, firma, `exp`) y resolver perfil activo.
4. Autorizar la acción y campos sensibles.
5. Validar el request contra un esquema cerrado.
6. Normalizar valores permitidos.
7. Ejecutar SQL parametrizado con credencial server-side.
8. Mapear a DTO público y eliminar campos internos.
9. Emitir envelope/status estable.
10. Registrar métricas y auditoría mínima.

## 10. Logging seguro

Registrar:

- `requestId`, action y versión de contrato.
- UUID del operador validado o identificador interno no sensible.
- resultado, HTTP status, código estable, duración y número de filas.
- versión del workflow y dependencia que falló.

No registrar:

- JWT, refresh token, OTP o credenciales Supabase.
- correo, teléfono, notas médicas o expediente completo.
- URLs/IDs de documentos y Drive salvo un identificador redactado necesario para soporte.
- SQL con valores interpolados ni responses completas.

## 11. Prueba con el seed

Después de aplicar migración y seed en un entorno de desarrollo:

1. `element.search` con `query: "prueba"` debe devolver `PDMU-SEED-001`.
2. `element.search` con un término inexistente debe devolver `200`, `items: []`.
3. `element.get` con `PDMU-SEED-001` debe devolver el elemento, un documento activo y assets en estado coherente.
4. `element.get` con `PDMU-NO-EXISTE` debe devolver `404 NOT_FOUND`.
5. Requests inválidos deben coincidir con los fixtures de error.
6. Confirmar que ningún response contiene el UUID `00000000-0000-4000-8000-000000000101` ni IDs de Drive.

Los fixtures son datos ficticios y no sustituyen pruebas de autorización.

## 12. Convivencia con legacy

- El frontend actual continúa usando el buscador legacy sin cambios.
- v2 se despliega con URL/feature flag server-side independiente y se prueba primero fuera de React.
- Durante shadow-read, comparar resultados por `element_code`, sin alterar la respuesta legacy.
- Registrar diferencias de conteo/identidad con `requestId`, sin copiar PII completa a logs.
- No hacer fallback silencioso ante `401`, `403`, `VALIDATION_ERROR` o `INTERNAL_ERROR`: ocultaría problemas de seguridad o contrato.
- Un futuro fallback legacy solo debe activarse para indisponibilidad explícita de v2, con telemetría, ventana temporal y criterio de retiro.

## 13. Criterios para preparar después el frontend v2

Codex puede preparar un adaptador frontend v2 con fallback legacy únicamente cuando:

- Ambos fixtures de éxito y errores están aprobados.
- El workflow dev valida JWT y permisos de verdad.
- Las consultas parametrizadas pasan pruebas con seed y paginación.
- `requestId`, status HTTP y envelopes son estables.
- No se exponen UUIDs internos, credenciales o PII no requerida.
- Shadow-read muestra resultados conciliados con legacy.
- Existe feature flag y rollback documentado.
- Se decide exactamente qué errores permiten fallback y cuánto tiempo convivirá.

El primer cambio frontend debe ser un servicio/adaptador aislado; las páginas no deben conocer Supabase, SQL ni detalles de fallback.
