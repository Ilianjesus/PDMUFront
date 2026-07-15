# Propuesta de contratos frontend ↔ n8n v2

Estado: diseño, no implementado.  
Fecha: 29 de junio de 2026.

## 1. Objetivo y alcance

Esta propuesta define contratos nuevos para cuatro dominios:

- `pdmu-elements`
- `pdmu-payments`
- `pdmu-attendance`
- `pdmu-dashboard`

`pdmu-auth-otp-email` queda fuera del contrato frontend: continúa siendo un **Supabase Send Email Hook → n8n**, nunca una llamada directa de React.

El diseño elimina del contrato público conceptos de almacenamiento como `sheet`, `row_number`, nombres de columnas de Sheets y wrappers propios de n8n. No cambia el código ni los workflows actuales; sirve como especificación para una migración posterior coordinada.

### Nota de persistencia Supabase v1

Durante la transición, el `elementId` público de estos contratos puede mapear al `element_code` heredado de Sheets. Internamente Supabase usa `elements.id` UUID como llave primaria y n8n resuelve `element_code → UUID` antes de operar relaciones.

React debe tratar `elementId` como string opaco: no validará su formato, no extraerá significado y no asumirá si contiene el código legado o un UUID. Esto permite cambiar la representación pública más adelante sin tocar las pantallas.

Google Sheets será una fuente legacy temporal durante carga, conciliación y ejecución paralela. Una vez completado el cutover por vertical, Supabase será la autoridad y Sheets quedará como respaldo/exportación de solo lectura hasta su retiro.

## 2. Decisión de arquitectura

### Un endpoint público por dominio

Se propone una URL configurable por workflow:

```text
VITE_N8N_ELEMENTS_URL
VITE_N8N_PAYMENTS_URL
VITE_N8N_ATTENDANCE_URL
VITE_N8N_DASHBOARD_URL
```

Estas variables seguirán siendo públicas en el navegador. La seguridad debe depender de validación de token y permisos en una capa confiable, nunca de ocultar la URL.

Cada endpoint recibe `POST` y discrimina la operación mediante `action`. Aunque algunas operaciones sean lecturas, este formato simplifica el enrutado hacia un único workflow n8n por dominio y evita depender de rutas dinámicas. Si posteriormente se coloca un API Gateway delante de n8n, el mismo modelo puede exponerse con recursos y métodos REST sin cambiar los DTO internos.

Excepción: carga documental usa `multipart/form-data`, pero conserva la misma URL de `pdmu-elements` y la acción `element.document.upsert`.

### Acciones propuestas

| Workflow | Acciones públicas |
|---|---|
| `pdmu-elements` | `element.create`, `element.search`, `element.get`, `element.update`, `element.document.upsert` |
| `pdmu-elements` | `element.assets.provision` solo para reintento administrativo o invocación interna |
| `pdmu-payments` | `payment.create`, `payment.list`, `payment.correct`, `payment.cancel` |
| `pdmu-attendance` | `attendance.create`, `attendance.list`, `attendance.correct`, `attendance.cancel` |
| `pdmu-dashboard` | `dashboard.summary` |

Los nombres de acción son identificadores técnicos estables. La UI puede continuar usando textos en español.

## 3. Convenciones transversales

### 3.1 Headers

```http
Content-Type: application/json
Authorization: Bearer <supabase_access_token>
X-Request-Id: <uuid>
Idempotency-Key: <uuid>       # obligatorio en escrituras
```

Para `multipart/form-data`, el navegador genera el `Content-Type` y boundary.

- `Authorization`: futuro contrato de seguridad. n8n o un gateway debe validar firma, `iss`, `aud`, `exp` y permisos. No basta con decodificar el JWT.
- `X-Request-Id`: generado una vez por intento lógico; se conserva en frontend, n8n y logs.
- `Idempotency-Key`: obligatorio en create, update/correct, cancel, documentos y aprovisionamiento. Repetir la misma clave con el mismo payload devuelve el resultado original; con payload distinto devuelve `409 IDEMPOTENCY_CONFLICT`.
- El frontend no envía `operatorId`, rol ni correo como autoridad. El backend los obtiene del token validado.

### 3.2 Envelope JSON de solicitud

```json
{
  "contractVersion": "2.0",
  "action": "element.search",
  "data": {}
}
```

Reglas:

- `contractVersion` y `action` son obligatorios.
- Campos desconocidos deben rechazarse o ignorarse de forma explícita y documentada; se recomienda rechazarlos en comandos sensibles.
- Fechas de calendario: `YYYY-MM-DD`.
- Instantes: ISO 8601 UTC, por ejemplo `2026-06-29T18:42:11.123Z`.
- Dinero: entero en centavos, acompañado de moneda. Nunca float.
- IDs: strings opacos, estables e inmutables. React no interpreta su formato.
- Valores de catálogo viajan como códigos estables, no como labels visuales.
- `null` significa “eliminar/no informado”; campo ausente en un patch significa “sin cambio”.

### 3.3 Respuesta exitosa

```json
{
  "ok": true,
  "requestId": "018f...",
  "action": "element.search",
  "data": {},
  "meta": {
    "contractVersion": "2.0",
    "processedAt": "2026-06-29T18:42:11.123Z"
  }
}
```

La respuesta nunca se envuelve como `[ { "json": ... } ]` y no usa `status: "success"`/`"exito"`. n8n debe responder el objeto final.

### 3.4 Respuesta fallida

```json
{
  "ok": false,
  "requestId": "018f...",
  "action": "payment.create",
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Revisa los datos enviados.",
    "fieldErrors": {
      "periods": "Selecciona al menos un periodo."
    },
    "retryable": false
  },
  "meta": {
    "contractVersion": "2.0",
    "processedAt": "2026-06-29T18:42:11.123Z"
  }
}
```

`message` es seguro para mostrar al operador; detalles internos quedan en logs correlacionados por `requestId`.

### 3.5 HTTP status

| Status | Uso |
|---|---|
| `200` | Lectura, corrección, cancelación o replay idempotente exitoso |
| `201` | Recurso creado |
| `400` | JSON/acción/formato inválido |
| `401` | Token ausente, inválido o expirado |
| `403` | Sesión válida sin permiso |
| `404` | Recurso inexistente o no visible para el operador |
| `409` | Duplicado, conflicto de versión o idempotencia |
| `413` | Archivo/petición demasiado grande |
| `415` | Tipo de archivo no permitido |
| `422` | Regla de negocio no satisfecha |
| `429` | Rate limit |
| `500` | Error interno no recuperable |
| `502/503/504` | Dependencia externa no disponible/timeout |

### 3.6 Códigos de error comunes

```text
INVALID_REQUEST
UNSUPPORTED_CONTRACT_VERSION
UNSUPPORTED_ACTION
VALIDATION_ERROR
UNAUTHENTICATED
FORBIDDEN
NOT_FOUND
VERSION_CONFLICT
IDEMPOTENCY_CONFLICT
RATE_LIMITED
DEPENDENCY_UNAVAILABLE
INTERNAL_ERROR
```

Cada dominio añade códigos específicos. Los códigos son estables; el texto puede mejorar sin romper al frontend.

### 3.7 Paginación

Solicitud:

```json
{
  "page": {
    "limit": 25,
    "cursor": null
  }
}
```

Respuesta:

```json
{
  "meta": {
    "pagination": {
      "limit": 25,
      "nextCursor": "opaque-cursor-or-null",
      "hasMore": false
    }
  }
}
```

El cursor es opaco. No exponer `row_number`, offsets de Sheets ni IDs de implementación.

### 3.8 Concurrencia

Recursos editables devuelven `version` entero. Toda corrección/actualización incluye `expectedVersion`. Si ya cambió, se responde `409 VERSION_CONFLICT` con la versión actual, sin sobrescribir silenciosamente.

### 3.9 Auditoría

n8n registra server-side:

- `requestId` e idempotency key.
- Identidad/rol obtenidos del token.
- Acción y resource ID.
- Timestamp server-side.
- Resultado y duración.
- Before/after para correcciones y cancelaciones.
- Motivo obligatorio en acciones sensibles.

No registrar tokens, archivos completos, OTP, teléfono completo ni PII innecesaria.

## 4. Contrato `pdmu-elements`

### 4.1 Modelo canónico de elemento

```json
{
  "elementId": "el_01J...",
  "name": {
    "givenNames": "Ana María",
    "paternalSurname": "López",
    "maternalSurname": "García"
  },
  "birthDate": "2010-04-17",
  "sexCode": "F",
  "groupCode": null,
  "guardian": {
    "fullName": "Laura García",
    "phone": "5512345678"
  },
  "medicalNotes": null,
  "status": "active",
  "version": 1,
  "createdAt": "2026-06-29T18:42:11.123Z",
  "updatedAt": "2026-06-29T18:42:11.123Z"
}
```

Decisiones:

- `sexCode` debe provenir de un catálogo acordado. La primera migración puede mapear `Masculino/Femenino` a códigos sin cambiar la UI.
- `groupCode` se conserva nullable hasta decidir si `grupo` sigue siendo requerido.
- `medicalNotes` es dato sensible y debe devolverse solo con permiso.
- El contrato no incluye carpetas Drive, filas o nombres de hojas.

### 4.2 Registrar elemento — `element.create`

Request:

```json
{
  "contractVersion": "2.0",
  "action": "element.create",
  "data": {
    "name": {
      "givenNames": "Ana María",
      "paternalSurname": "López",
      "maternalSurname": "García"
    },
    "birthDate": "2010-04-17",
    "sexCode": "F",
    "groupCode": null,
    "guardian": {
      "fullName": "Laura García",
      "phone": "5512345678"
    },
    "medicalNotes": null
  }
}
```

Requeridos: nombres, apellido paterno, fecha de nacimiento, código de sexo, nombre y teléfono del tutor. Documentos no forman parte de esta transacción.

Response `201`:

```json
{
  "ok": true,
  "requestId": "...",
  "action": "element.create",
  "data": {
    "element": { "elementId": "el_01J...", "version": 1, "status": "active" },
    "provisioning": {
      "driveFolder": "pending",
      "qr": "pending"
    }
  },
  "meta": { "contractVersion": "2.0", "processedAt": "..." }
}
```

Errores propios:

- `ELEMENT_ALREADY_EXISTS`
- `INVALID_BIRTH_DATE`
- `INVALID_GUARDIAN_PHONE`
- `GROUP_NOT_FOUND`

Reglas server-side:

- Normalizar nombres/teléfono.
- Rechazar fecha futura.
- Detectar duplicado con una regla acordada, no solo coincidencia textual.
- `elementId`, timestamps y versión son generados server-side.
- El aprovisionamiento Drive/QR ocurre después de crear y no debe dejar duplicados si se reintenta.

### 4.3 Buscar elemento — `element.search`

Request:

```json
{
  "contractVersion": "2.0",
  "action": "element.search",
  "data": {
    "query": "ana lopez",
    "status": "active",
    "page": { "limit": 20, "cursor": null }
  }
}
```

Response:

```json
{
  "ok": true,
  "requestId": "...",
  "action": "element.search",
  "data": {
    "items": [
      {
        "elementId": "el_01J...",
        "displayName": "Ana María López García",
        "groupCode": null,
        "status": "active"
      }
    ]
  },
  "meta": {
    "contractVersion": "2.0",
    "processedAt": "...",
    "pagination": { "limit": 20, "nextCursor": null, "hasMore": false }
  }
}
```

No devuelve tutor, teléfono, salud, documentos ni expediente completo. Query mínima recomendada: 2 caracteres. Aplicar rate limit y búsqueda server-side.

### 4.4 Consultar expediente — `element.get`

Request:

```json
{
  "contractVersion": "2.0",
  "action": "element.get",
  "data": {
    "elementId": "el_01J...",
    "include": ["profile", "documents", "assets"]
  }
}
```

Valores permitidos en `include`: `profile`, `documents`, `assets`. Pagos y asistencias se consultan en sus workflows, no se mezclan en el expediente de elementos.

Response:

```json
{
  "ok": true,
  "requestId": "...",
  "action": "element.get",
  "data": {
    "element": { "elementId": "el_01J...", "version": 4 },
    "documents": [
      {
        "documentId": "doc_01J...",
        "type": "birth_certificate",
        "status": "available",
        "fileName": "acta.pdf",
        "uploadedAt": "...",
        "downloadUrl": "short-lived-authorized-url"
      }
    ],
    "assets": {
      "driveFolder": { "status": "ready" },
      "qr": { "status": "ready", "downloadUrl": "short-lived-authorized-url" }
    }
  },
  "meta": { "contractVersion": "2.0", "processedAt": "..." }
}
```

URLs de documentos/QR deben estar autorizadas o expirar. No exponer IDs internos de Drive si no son necesarios.

### 4.5 Actualizar datos — `element.update`

Request patch:

```json
{
  "contractVersion": "2.0",
  "action": "element.update",
  "data": {
    "elementId": "el_01J...",
    "expectedVersion": 4,
    "changes": {
      "guardian": { "phone": "5598765432" },
      "medicalNotes": null
    },
    "reason": "Actualización solicitada por tutor"
  }
}
```

El backend aplica allowlist de campos y valida el objeto completo. No usar `{ field, value }`, porque permite nombres dinámicos sin esquema y dificulta actualizaciones relacionadas.

Response: elemento actualizado con `version: 5` y `updatedAt`.

Errores: `ELEMENT_NOT_FOUND`, `FIELD_NOT_EDITABLE`, `VERSION_CONFLICT`.

### 4.6 Subir/reemplazar documento — `element.document.upsert`

Request `multipart/form-data`:

```text
contractVersion = "2.0"
action          = "element.document.upsert"
metadata        = JSON.stringify({
  "elementId": "el_01J...",
  "documentType": "birth_certificate",
  "replaceDocumentId": "doc_01J..." | null,
  "reason": "Documento actualizado"
})
file            = <binary PDF>
```

Catálogo inicial sugerido, sujeto a aprobación:

```text
guardian_id
medical_certificate
proof_of_address
birth_certificate
curp
enrollment_form
```

Response `201/200`:

```json
{
  "ok": true,
  "requestId": "...",
  "action": "element.document.upsert",
  "data": {
    "document": {
      "documentId": "doc_01J...",
      "elementId": "el_01J...",
      "type": "birth_certificate",
      "status": "available",
      "fileName": "acta.pdf",
      "sizeBytes": 283991,
      "sha256": "...",
      "uploadedAt": "...",
      "version": 2
    }
  },
  "meta": { "contractVersion": "2.0", "processedAt": "..." }
}
```

Validaciones obligatorias: allowlist de tipo, firma real PDF, MIME, tamaño individual/total, antivirus, nombre seguro, hash, permisos y reemplazo atómico. El archivo anterior se conserva según política de auditoría, no se sobrescribe sin rastro.

### 4.7 Crear carpeta Drive/QR — `element.assets.provision`

**Preferencia:** subflujo interno e idempotente disparado por `element.create`; React solo observa `provisioning`.

Puede exponerse a administradores para reintento:

```json
{
  "contractVersion": "2.0",
  "action": "element.assets.provision",
  "data": {
    "elementId": "el_01J...",
    "assets": ["driveFolder", "qr"],
    "retryFailedOnly": true
  }
}
```

Response:

```json
{
  "ok": true,
  "requestId": "...",
  "action": "element.assets.provision",
  "data": {
    "driveFolder": { "status": "ready" },
    "qr": { "status": "ready" }
  },
  "meta": { "contractVersion": "2.0", "processedAt": "..." }
}
```

No crear otra carpeta/QR si ya existe. `force` no debe estar disponible para el frontend normal.

## 5. Contrato `pdmu-payments`

### 5.1 Modelo canónico

```json
{
  "paymentId": "pay_01J...",
  "elementId": "el_01J...",
  "periods": [
    { "year": 2026, "month": 6 }
  ],
  "amount": { "value": 20000, "currency": "MXN" },
  "method": "cash",
  "reference": null,
  "status": "posted",
  "version": 1,
  "recordedAt": "...",
  "recordedBy": { "operatorId": "...", "displayName": "..." }
}
```

`amount.value` está en centavos. Códigos iniciales de método: `cash`, `transfer`; el catálogo debe vivir server-side.

### 5.2 Registrar pago — `payment.create`

Request:

```json
{
  "contractVersion": "2.0",
  "action": "payment.create",
  "data": {
    "elementId": "el_01J...",
    "periods": [
      { "year": 2026, "month": 6 },
      { "year": 2026, "month": 7 }
    ],
    "method": "cash",
    "reference": null,
    "notes": null
  }
}
```

El frontend **no envía nombre ni cantidad autoritativa**. n8n resuelve el elemento, tarifa, moneda, periodos válidos y duplicados. Si se necesita mostrar un cálculo previo, usar una acción futura `payment.quote`; nunca confiar en el total mostrado por React.

Response `201`: pago canónico completo, con monto calculado y folio si existe.

Errores propios:

- `ELEMENT_NOT_FOUND`
- `INVALID_PAYMENT_PERIOD`
- `PERIOD_ALREADY_PAID`
- `PAYMENT_METHOD_NOT_ALLOWED`
- `PAYMENT_POLICY_UNAVAILABLE`

### 5.3 Consultar pagos — `payment.list`

Request:

```json
{
  "contractVersion": "2.0",
  "action": "payment.list",
  "data": {
    "elementId": "el_01J...",
    "year": 2026,
    "status": ["posted", "cancelled"],
    "page": { "limit": 25, "cursor": null }
  }
}
```

Response:

```json
{
  "ok": true,
  "requestId": "...",
  "action": "payment.list",
  "data": {
    "element": { "elementId": "el_01J...", "displayName": "..." },
    "items": [],
    "summary": {
      "year": 2026,
      "coveredMonths": [1, 2, 3],
      "pendingMonths": [4, 5, 6, 7, 8, 9, 10, 11, 12]
    }
  },
  "meta": { "pagination": {}, "contractVersion": "2.0", "processedAt": "..." }
}
```

No devolver filas vacías sintetizadas; la UI puede construir los 12 meses a partir de `summary`.

### 5.4 Corregir pago — `payment.correct`

```json
{
  "contractVersion": "2.0",
  "action": "payment.correct",
  "data": {
    "paymentId": "pay_01J...",
    "expectedVersion": 1,
    "changes": {
      "periods": [{ "year": 2026, "month": 7 }],
      "method": "transfer",
      "reference": "REF-123"
    },
    "reason": "Se capturó el mes incorrecto"
  }
}
```

La cantidad se recalcula server-side. No modificar pagos cancelados. Guardar before/after y operador. Response: recurso corregido con nueva versión y objeto `audit` mínimo `{ correctionId, correctedAt }`.

Errores: `PAYMENT_NOT_FOUND`, `PAYMENT_CANCELLED`, `PERIOD_ALREADY_PAID`, `VERSION_CONFLICT`.

### 5.5 Cancelar pago — `payment.cancel`

```json
{
  "contractVersion": "2.0",
  "action": "payment.cancel",
  "data": {
    "paymentId": "pay_01J...",
    "expectedVersion": 2,
    "reason": "Pago registrado por duplicado"
  }
}
```

Cancelación lógica, nunca borrado físico. Response devuelve `status: "cancelled"`, `cancelledAt`, `cancelledBy` y versión nueva. Repetir con la misma idempotency key devuelve el mismo resultado.

## 6. Contrato `pdmu-attendance`

### 6.1 Modelo canónico

```json
{
  "attendanceId": "att_01J...",
  "elementId": "el_01J...",
  "status": "present",
  "source": "qr",
  "occurredAt": "2026-06-29T18:42:11.123Z",
  "recordedAt": "2026-06-29T18:42:12.020Z",
  "version": 1,
  "recordedBy": { "operatorId": "...", "displayName": "..." }
}
```

Catálogo propuesto: `present`, `absent`, `late`, `excused`; debe confirmarse con negocio. `source`: `manual`, `qr`, y futuras fuentes acordadas. El servidor genera los timestamps.

### 6.2 Registrar asistencia — `attendance.create`

Manual:

```json
{
  "contractVersion": "2.0",
  "action": "attendance.create",
  "data": {
    "elementId": "el_01J...",
    "source": "manual"
  }
}
```

QR:

```json
{
  "contractVersion": "2.0",
  "action": "attendance.create",
  "data": {
    "qrCode": "opaque-signed-or-random-code",
    "source": "qr"
  }
}
```

El QR futuro no debería contener directamente PII ni confiar en un ID predecible. n8n resuelve `qrCode → elementId`. Si durante transición el QR actual contiene el ID, el adaptador v2 puede mapearlo temporalmente sin convertirlo en contrato definitivo.

Response `201`: asistencia canónica con timestamp server-side.

Errores propios:

- `ELEMENT_NOT_FOUND`
- `QR_INVALID`
- `QR_REVOKED`
- `ATTENDANCE_ALREADY_RECORDED`
- `ATTENDANCE_WINDOW_CLOSED`

La política de duplicados debe estar en servidor por elemento, evento/fecha y ventana de tiempo. La idempotency key cubre reintentos técnicos; la regla de negocio cubre duplicados semánticos.

### 6.3 Consultar historial — `attendance.list`

```json
{
  "contractVersion": "2.0",
  "action": "attendance.list",
  "data": {
    "elementId": "el_01J...",
    "from": "2026-06-01",
    "to": "2026-06-30",
    "status": ["present", "late"],
    "page": { "limit": 50, "cursor": null }
  }
}
```

Response: elemento mínimo, `items` canónicos y paginación. Orden recomendado: `occurredAt` descendente. Validar rango máximo para evitar consultas masivas.

### 6.4 Corregir asistencia — `attendance.correct`

```json
{
  "contractVersion": "2.0",
  "action": "attendance.correct",
  "data": {
    "attendanceId": "att_01J...",
    "expectedVersion": 1,
    "status": "excused",
    "reason": "Se recibió justificante"
  }
}
```

Solo `status` y campos explícitamente autorizados pueden cambiar. `source`, identidad y timestamps originales permanecen inmutables. Response devuelve registro versión 2 y referencia de auditoría.

### 6.5 Cancelar asistencia — `attendance.cancel`

```json
{
  "contractVersion": "2.0",
  "action": "attendance.cancel",
  "data": {
    "attendanceId": "att_01J...",
    "expectedVersion": 2,
    "reason": "Registro generado por lectura duplicada"
  }
}
```

Cancelación lógica. El registro conserva valor original y agrega `recordStatus: "cancelled"`, actor, timestamp y motivo. No reutilizar el estado de asistencia (`present/late/...`) para representar cancelación administrativa.

## 7. Contrato `pdmu-dashboard`

### 7.1 Resumen — `dashboard.summary`

Request:

```json
{
  "contractVersion": "2.0",
  "action": "dashboard.summary",
  "data": {
    "period": {
      "from": "2026-06-01",
      "to": "2026-06-29"
    },
    "timezone": "America/Mexico_City",
    "scope": "organization"
  }
}
```

`scope` permitido depende del rol; el backend no acepta un alcance mayor al autorizado. Puede usar un periodo por defecto server-side, pero siempre lo devuelve resuelto.

Response:

```json
{
  "ok": true,
  "requestId": "...",
  "action": "dashboard.summary",
  "data": {
    "period": {
      "from": "2026-06-01",
      "to": "2026-06-29",
      "timezone": "America/Mexico_City"
    },
    "metrics": [
      {
        "key": "active_elements",
        "label": "Elementos activos",
        "value": 124,
        "unit": "count",
        "severity": "neutral"
      },
      {
        "key": "pending_payments",
        "label": "Pagos pendientes",
        "value": 18,
        "unit": "count",
        "severity": "warning"
      }
    ],
    "alerts": [
      {
        "alertId": "alert_01J...",
        "type": "payment_overdue",
        "severity": "warning",
        "title": "Mensualidades pendientes",
        "description": "18 elementos requieren seguimiento.",
        "count": 18,
        "target": { "route": "/PanelAdmin", "filter": "payments_pending" }
      }
    ],
    "recentActivity": [
      {
        "activityId": "act_01J...",
        "type": "payment_recorded",
        "title": "Pago registrado",
        "occurredAt": "..."
      }
    ],
    "freshness": {
      "generatedAt": "...",
      "sourceUpdatedAt": "...",
      "partial": false
    }
  },
  "meta": { "contractVersion": "2.0", "processedAt": "..." }
}
```

Decisiones:

- Métricas como array extensible, no objeto rígido con cuatro propiedades.
- `key` es estable; `label` es presentacional.
- `severity`: `neutral`, `info`, `warning`, `critical`, `success`.
- Alertas no incluyen PII salvo permiso/necesidad explícita; enlazan a una vista filtrada.
- `freshness.partial` permite diferenciar “cero” de “datos incompletos”.
- Si una fuente falla, responder éxito parcial solo cuando se indique en `freshness`; de otro modo usar error 503.

## 8. Matriz de autorización propuesta

Los nombres de rol son ilustrativos; deben alinearse con los roles reales.

| Acción | Operador | Administrador | Sistema/n8n interno |
|---|---:|---:|---:|
| `element.search/get` | Sí, alcance permitido | Sí | Sí |
| `element.create/update` | Según política | Sí | Sí |
| `element.document.upsert` | Según política | Sí | Sí |
| `element.assets.provision` | No | Solo retry | Sí |
| `payment.create/list` | Según política | Sí | Sí |
| `payment.correct/cancel` | No o permiso especial | Sí | Sí |
| `attendance.create/list` | Sí | Sí | Sí |
| `attendance.correct/cancel` | No o permiso especial | Sí | Sí |
| `dashboard.summary` | Sí, scope limitado | Sí | Sí |

La UI puede ocultar acciones, pero n8n debe aplicar la matriz siempre.

## 9. Adaptadores frontend sugeridos

La interfaz de componentes no debería conocer el envelope. Los servicios v2 lo encapsulan:

```text
src/services/workflows/v2/
├── workflowClient.js
├── elementsWorkflow.js
├── paymentsWorkflow.js
├── attendanceWorkflow.js
└── dashboardWorkflow.js
```

Ejemplos conceptuales:

```js
elements.create(input)
elements.search({ query, cursor })
elements.get({ elementId, include })
elements.update({ elementId, expectedVersion, changes, reason })

payments.create({ elementId, periods, method })
payments.list({ elementId, year, cursor })
payments.correct({ paymentId, expectedVersion, changes, reason })
payments.cancel({ paymentId, expectedVersion, reason })
```

El cliente común generaría `X-Request-Id`, conservaría idempotency keys durante reintentos, adjuntaría el token y convertiría errores v2 a una forma interna. No debe reintentar automáticamente comandos si no puede reutilizar la misma idempotency key.

## 10. Migración desde contratos actuales

### No hacer big bang

1. Implementar endpoints v2 en paralelo; los actuales siguen activos.
2. Añadir pruebas de contrato contra fixtures de n8n.
3. Migrar una operación de lectura de bajo riesgo (`dashboard.summary` o `element.search`).
4. Migrar escrituras con idempotencia y auditoría: asistencia, pagos, elementos/documentos.
5. Migrar correcciones/cancelaciones y retirar dependencia de `row_number`.
6. Observar errores/latencia y habilitar por feature flag.
7. Retirar variables/endpoints viejos solo después de conciliación.

### Mapeos temporales

| Contrato actual | v2 |
|---|---|
| `ID` | `elementId` |
| `Nombre` + apellidos | `name` / `displayName` |
| `MesesPagados` string | `periods[]` |
| `Cantidad` pesos | `amount.value` centavos, calculado server-side |
| `TipoPago` / `Tipo de Pago` | `method` |
| `FechaHora` string local | `occurredAt` ISO UTC |
| `Estado` label | `status` code |
| `sheet` + `operacion` | action de dominio |
| `row_number` | ID estable del recurso |
| `success` / `exito` | `ok: true` |
| wrappers n8n | envelope v2 directo |

## 11. Observabilidad y operación

Cada workflow debe medir:

- Conteo y latencia por `action` y resultado.
- Errores por código, sin payload completo.
- Duplicados prevenidos por idempotencia.
- Conflictos de versión.
- Fallas de Drive/Sheets/Supabase/proveedor dependiente.
- Tamaño y resultado de archivos sin conservar contenido en logs.

Frontend puede mostrar `requestId` en un detalle copiable de error para soporte, no como mensaje principal.

## 12. Decisiones pendientes antes de implementar

1. Catálogo final de sexo, grupos, documentos, métodos de pago y estados de asistencia.
2. Roles reales y permisos por acción.
3. Regla de duplicado de elementos.
4. Tarifa, periodos válidos, moneda y política de corrección/cancelación de pagos.
5. Ventana/evento que define asistencia duplicada.
6. Formato actual del QR y estrategia para códigos opacos/revocables.
7. Límites de archivo, almacenamiento, retención y acceso a documentos.
8. Si Drive seguirá siendo almacenamiento definitivo o transitorio.
9. Capa que validará JWT Supabase: n8n directamente o gateway.
10. Almacén de idempotencia, versiones y auditoría mientras los datos sigan en Sheets/n8n Tables.
11. Política para éxito parcial en aprovisionamiento y dashboard.
12. Periodo de convivencia y criterio para retirar contratos actuales.

## 13. Primera implementación recomendada

La primera vertical debería ser `element.search` v2 porque permite validar token, envelope, errores, paginación, request ID y observabilidad sin mutar datos. Después:

1. `dashboard.summary`.
2. `attendance.create/list` con idempotencia.
3. `payment.create/list`, moviendo tarifa al servidor.
4. `element.create/get/update`.
5. Documentos y aprovisionamiento.
6. Correcciones/cancelaciones con auditoría y control de versión.

No activar `Authorization` desde React hasta que el receptor valide realmente el JWT y aplique permisos.
