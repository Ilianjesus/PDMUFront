# Refactorización integral y endurecimiento técnico

## Resumen

Esta fase reorganiza la presentación y el manejo de estado del frontend sin cambiar reglas de negocio, payloads ni endpoints. Supabase Auth continúa siendo responsable de la sesión OTP; React solo solicita y verifica el código. Los datos de inscripciones, pagos y asistencias continúan en los workflows actuales de n8n/Sheets/n8n Tables.

No se añadieron conexiones a tablas de Supabase, secretos, autenticación de webhooks ni cambios del lado de n8n.

## Arquitectura resultante

La separación principal queda así:

- `src/pages`: pantallas y coordinación de cada flujo.
- `src/components`: layout y módulos administrativos.
- `src/components/ui`: estados y diálogos reutilizables sin dependencia de una librería visual.
- `src/hooks`: comportamiento reutilizable del frontend.
- `src/contexts` y `src/services/auth`: frontera neutral de sesión e implementación Supabase OTP.
- `src/services/workflows`: adaptadores de los contratos n8n existentes.
- `src/services/httpClient.js`: transporte HTTP, timeout, parseo y errores normalizados.
- `src/config`: único punto de lectura de variables `VITE_*`.
- `src/styles`: estilos por pantalla más tokens y estados comunes en `ui.css`.

Las rutas operativas continúan detrás de `RequireAuth`. `App.jsx` carga de forma diferida dashboard, inscripciones, pagos, asistencias, scanner, estadísticas y panel administrativo. Esto mantiene pequeña la ruta de login y evita incluir `html5-qrcode` en el bundle inicial.

## Componentes y utilidades reutilizables

- `LoadingState`: carga accesible y consistente.
- `EmptyState`: ausencia de registros diferenciada de un error.
- `StatusMessage`: mensajes con `role`/`aria-live` apropiados.
- `ConfirmDialog`: confirmación accesible, cierre con Escape y bloqueo durante operaciones.
- `useDebouncedValue`: reduce llamadas repetidas del buscador mientras se escribe.
- `ui.css`: tokens de color, radios, foco visible, respeto de movimiento reducido y estilos base.

## Cambios por módulo

### Inscripciones

- Validación por paso antes de avanzar.
- Fecha futura y teléfono de diez dígitos validados antes del envío.
- Archivos limitados a PDF desde el selector y mediante validación local.
- Estado de envío bloquea navegación y doble submit.
- Estado inicial extraído como constantes y restauración completa después del éxito.
- Labels y descripción de progreso accesibles.

El `FormData` y sus nombres de campo no se modificaron.

### Pagos

- Los meses ahora son botones accesibles con `aria-pressed`.
- Validación local de selección y total antes del envío.
- Al cambiar de elemento se limpian meses y cantidad anteriores.
- Mensajes de resultado integrados en la pantalla.
- Edición/eliminación administrativa usa un diálogo reutilizable.
- Se corrigió el cierre del diálogo después de guardar o eliminar.
- Se valida la cantidad antes de actualizar.

Los payloads de registro, edición y eliminación permanecen en `paymentsWorkflow.js` sin cambios.

### Asistencias

- Tabla administrativa extraída de estilos inline y contenida en scroll horizontal móvil.
- Guardar queda deshabilitado si no hay cambios.
- Una edición fallida revierte el estado visual al último valor confirmado.
- Eliminación usa diálogo interno en vez de `window.confirm`.
- Estados vacíos, éxito y error son explícitos.
- El scanner bloquea callbacks concurrentes del mismo QR, evita reenvíos ya exitosos y deja de registrar en consola cada frame sin código.
- Errores de cámara y red se presentan dentro de la pantalla y permiten reintentar.

Los contratos de asistencia manual, QR, edición y eliminación no se modificaron.

### Panel administrativo

- Se eliminó el callback genérico muerto que los módulos ya no consumían.
- Al cambiar de módulo se descartan los datos anteriores antes de cargar.
- Estado de carga común, mensaje accesible y confirmación de borrado interna.
- Botón para cambiar de elemento sin recargar la página.
- Botonera adaptable en grid, sin desbordamiento al mostrar cuatro o más acciones.

### Dashboard/Home

- Error de estadísticas diferenciado de listas vacías.
- Reintento manual sin recargar la aplicación.
- Botones flotantes con nombre accesible y título.
- Se conserva la estructura de respuesta vigente del workflow de estadísticas.

### Login y navegación

- Supabase OTP, `shouldCreateUser: false`, verificación `type: "email"`, logout y sesión neutral permanecen intactos.
- La UI conserva correo → código y el código variable de seis a ocho dígitos.
- Labels, alternativa de imagen y navegación activa mejorados.
- Rutas desconocidas vuelven a `/home`, que a su vez continúa protegida.
- No existe una llamada desde React al webhook de entrega de correo OTP.

## Bugs corregidos

1. El modal administrativo de pagos permanecía abierto después de una operación exitosa porque intentaba cerrarse mientras el estado `saving/deleting` seguía activo.
2. La selección de un documento quedaba visible después de una subida exitosa porque la limpieza estaba bloqueada por el mismo estado `uploading`.
3. El scanner podía procesar el mismo resultado más de una vez antes de que React aplicara el cambio de estado.
4. Volver al buscador de pagos y elegir otro elemento conservaba meses y total del elemento anterior.
5. El panel podía renderizar temporalmente datos del módulo anterior mientras cargaba otro.
6. Los pasos de inscripción permitían avanzar sin que el navegador validara campos obligatorios ocultos después.
7. Una edición de asistencia fallida dejaba en pantalla un valor que nunca fue persistido.
8. Existían patrones HTML no válidos o inaccesibles: botón dentro de enlace, filas de búsqueda y meses basados en `div`, flecha de expansión sin semántica y campos sin label.

## Bundle y dependencias

El enrutado usa `React.lazy`/`Suspense`. En la medición de producción de esta fase, el chunk inicial pasó de aproximadamente 907 kB a 447 kB minificado (de ~267 kB a ~131 kB con gzip); `html5-qrcode` queda en el chunk del scanner (~337 kB minificado, ~101 kB con gzip) y solo se descarga al abrir esa ruta.

Se retiraron dependencias sin imports ni configuración activa:

- Axios.
- Tailwind y su plugin de Vite.
- PostCSS/autoprefixer instalados únicamente para la configuración Tailwind ausente.
- `react-hook-form`.
- `react-hot-toast`.
- `react-qr-barcode-scanner`.

También se retiraron residuos sin consumidores del template inicial (`App.css`, `react.svg`) y el componente obsoleto `Navigation.jsx`; la navegación activa vive en `Layout.jsx`.

Firebase y su adaptador legado se conservan temporalmente como código de rollback documentado. No participan en el login normal y pueden retirarse en una tarea separada después de confirmar que no se requiere recuperar sesiones o identidades antiguas.

## Seguridad y contratos

- Las variables `VITE_*` siguen siendo públicas en el navegador y no se consideran secretos.
- `.env.local` permanece cubierto por `*.local` en `.gitignore`.
- `.env.example` contiene únicamente nombres vacíos.
- No se añadió `Authorization` a workflows para no alterar los contratos actuales.
- La protección de rutas es UX/control de sesión del frontend, no autorización server-side.
- Los servicios de workflows continúan siendo el único consumidor de los endpoints configurados.

## Deuda pendiente y próximos pasos

Prioridad recomendada:

1. Validar tokens de Supabase en una capa confiable delante de n8n y después acordar cómo adjuntar `Authorization: Bearer` sin romper consumidores actuales.
2. Definir roles/permisos reales y hacer cumplir autorización server-side por operación; ocultar botones en React no es suficiente.
3. Añadir pruebas automatizadas de adaptadores, formularios y rutas protegidas, además de pruebas E2E de OTP con un entorno controlado.
4. Retirar Firebase y su configuración versionada cuando se confirme que ya no es necesario como rollback.
5. Acordar límites de tamaño, retención y análisis de archivos para documentos; esta fase valida tipo PDF en cliente, pero el backend debe volver a validarlo.
6. Evaluar una migración futura de datos a Supabase únicamente después de definir modelo, RLS, conciliación y plan de reversión.
7. Reducir más el bundle inicial evaluando el peso de Supabase/lucide y optimizando la imagen del logo; no es bloqueante después del route splitting.
8. Revisar las vulnerabilidades transitivas con `npm audit` de forma controlada. No ejecutar `npm audit fix --force` automáticamente.

## Validación manual recomendada

- Solicitar y verificar OTP de un operador autorizado; refrescar una ruta privada y cerrar sesión.
- Completar inscripción con y sin PDFs, incluido rechazo de archivo no PDF.
- Registrar un pago, volver atrás y seleccionar otro elemento.
- Registrar asistencia manual y por QR; denegar permisos de cámara para comprobar el error recuperable.
- En panel admin: abrir los tres módulos, editar y eliminar un registro y cancelar cada diálogo.
- Simular caída de cada webhook para comprobar que se diferencia error de estado vacío.

La validación automatizada disponible en el repositorio para esta fase es ESLint y el build de producción de Vite. No hay suite de pruebas configurada todavía.
