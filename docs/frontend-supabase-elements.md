# Elementos desde React + Supabase directo

Estado: primera vertical business conectada detrás de un feature flag.

## Alcance

Con `VITE_USE_SUPABASE_BUSINESS=true`, React usa la sesión OTP actual para:

- buscar elementos con `search_elements`;
- consultar el expediente con `get_element`;
- crear el perfil inicial con `create_element`.

No se conectaron pagos, asistencias, dashboard, edición, eliminación ni archivos. No se modificó n8n y los servicios legacy permanecen disponibles para rollback.

## Variables

```env
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
VITE_USE_SUPABASE_BUSINESS=true
```

Solo se utiliza la publishable key. Las tres variables `VITE_*` son visibles en el navegador; jamás se debe colocar una `service_role`, secret key, contraseña PostgreSQL o secreto n8n en ellas.

El cliente compartido está en `src/services/auth/supabaseClient.js`. Mantiene `persistSession`, renovación automática y detección de sesión en URL. La capa business reutiliza ese cliente para que Supabase envíe el JWT del usuario autenticado y RLS/RPC resuelvan `auth.uid()`; no administra ni duplica el flujo OTP.

## Activación y prioridad

Activar:

```env
VITE_USE_SUPABASE_BUSINESS=true
```

Reiniciar Vite o reconstruir el despliegue. Cuando está activo, Supabase tiene prioridad sobre `VITE_USE_ELEMENTS_V2` para el Panel de expedientes y para Registrar Elemento.

Desactivar y volver a la integración anterior:

```env
VITE_USE_SUPABASE_BUSINESS=false
```

Si también se desea volver al endpoint legacy original en vez de n8n elements v2:

```env
VITE_USE_ELEMENTS_V2=false
```

El rollback no elimina datos creados en Supabase; únicamente cambia qué adaptador usa React.

## Capa de servicios

```text
src/services/
├── elementsService.js                 # selección Supabase/legacy
└── supabaseBusiness/
    ├── elementsRepository.js          # API de elementos
    ├── mappers.js                     # DTO RPC → modelo React
    └── supabaseRpcClient.js            # sesión, llamada y errores
```

API pública preparada:

```js
searchElementsSupabase({ query, limit, cursor });
getElementSupabase({ elementId, include });
createElementSupabase(input);
```

`elementId` se conserva como string opaco. La UI no valida ni interpreta si es UUID, código legado u otro formato.

## Flujos conectados

### Búsqueda

El `Buscador` del Panel Admin llama `search_elements` con query, límite máximo 50 y estado activo. La respuesta se adapta a:

- `ID`, `Nombre`, `Nombres`;
- `ApellidoPaterno`, `ApellidoMaterno`;
- `displayName`, `groupCode`, `status`.

La RPC de búsqueda v1 solo devuelve `display_name`, no las partes estructuradas del nombre. Por eso el resultado resumido usa el nombre completo en `Nombre`/`Nombres` y deja los apellidos separados vacíos; el expediente sí devuelve todos los campos estructurados.

Registrar Pago reutiliza el componente `Buscador`, pero fuerza expresamente la fuente legacy. Esto evita enviar el ID opaco de Supabase al workflow de pagos, que todavía no forma parte de esta vertical.

### Expediente

El botón **Información** del Panel Admin llama `get_element`. El resultado se adapta al modelo de `ModuloInfo`, que opera en modo lectura mientras el flag está activo.

En ese modo:

- no se ejecutan updates por workflow;
- no se ofrecen cargas documentales;
- se muestra únicamente metadata documental;
- Pagos, Asistencias y eliminación quedan deshabilitados para evitar mezclar IDs Supabase con contratos legacy.

Al apagar el flag, el Panel vuelve a su comportamiento legacy anterior.

### Registro

Registrar Elemento llama `create_element` con los datos personales y del tutor. React genera únicamente un UUID de idempotencia (`p_request_id`); la RPC genera el ID de entidad, código, versión, timestamps y auditoría.

La pantalla conserva el tercer paso para hacer visible la limitación, pero los inputs de PDF quedan deshabilitados. El resultado exitoso aclara que solo se creó el perfil y que documentos/Drive siguen pendientes.

## Errores

La capa RPC normaliza mensajes para:

- perfil ausente o inactivo (`ACTIVE_OPERATOR_REQUIRED`);
- permisos insuficientes (`ADMIN_OPERATOR_REQUIRED`/`42501`);
- sesión ausente, JWT inválido o expirado;
- campos obligatorios, fecha y teléfono inválidos;
- elemento no encontrado;
- conflicto único o `ELEMENT_ALREADY_EXISTS`.

La RPC `create_element` v1 todavía no define una regla de duplicado por identidad (nombre + fecha u otra clave). El frontend puede presentar conflictos reportados por PostgreSQL, pero no sustituye esa regla de negocio; debe resolverse server-side en una migración posterior.

## Limitaciones

- Sin paginación por cursor: `search_elements` v1 devuelve como máximo 50 filas y solo indica `hasMore`.
- Consulta de expediente en modo lectura; edición pendiente.
- Metadata documental sin descarga, carga, Drive ni Supabase Storage.
- Sin pagos, asistencias o dashboard directos.
- Sin borrado físico ni cancelación desde esta pantalla.
- Sin aprovisionamiento QR/Drive.
- n8n permanece únicamente en las funciones legacy no migradas.

## Prueba manual recomendada

1. Iniciar sesión por OTP con un operador `active`.
2. Activar `VITE_USE_SUPABASE_BUSINESS=true` y reiniciar la app.
3. Buscar `PDMU-SEED-001` o un nombre conocido desde Panel Admin.
4. Abrir **Información** y comprobar datos y metadata en modo lectura.
5. Registrar un elemento sin seleccionar archivos y confirmar que Supabase devuelve ID/código.
6. Buscar el nuevo elemento.
7. Cerrar sesión y confirmar que las rutas protegidas conservan el comportamiento actual.
8. Probar un usuario sin perfil/inactivo y comprobar el mensaje de operador activo.
9. Desactivar el flag y verificar búsqueda, expediente y registro legacy.
