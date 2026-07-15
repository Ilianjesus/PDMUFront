# Frontera de acceso y sesión

Fecha: 28 de junio de 2026  
Alcance: primera refactorización P0 del frontend. No modifica workflows ni contratos de n8n.

> Actualización del 28 de junio de 2026: la frontera de rutas descrita aquí sigue vigente, pero Firebase fue reemplazado como proveedor activo por Supabase Auth OTP. El estado actual está en `docs/auth-supabase-otp.md`.

## Estado actual

La aplicación conserva Firebase Authentication con correo y contraseña como proveedor de identidad. La diferencia es que los componentes ya no reciben ni consultan un `FirebaseUser`: consumen una interfaz neutral proporcionada por `AuthProvider`.

```js
{
  authStatus, // "loading" | "authenticated" | "unauthenticated"
  session,    // { uid, email, displayName, provider } | null
  login(email, password),
  logout(),
  getAccessToken(forceRefresh)
}
```

La implementación específica vive en `src/services/auth/firebaseAuth.js`. Esta capa configura `browserSessionPersistence`, observa los cambios de Firebase, normaliza el usuario y obtiene el token cuando sea necesario. `getAccessToken` queda disponible para una fase posterior, pero **todavía no se adjunta a los webhooks** para no cambiar sus contratos actuales.

La configuración de persistencia se espera antes de suscribir el estado inicial. Un error se captura y registra; la aplicación continúa observando la sesión para no convertir un fallo de persistencia en un bloqueo total. El flag anterior `localStorage.isLoggedIn` fue eliminado porque no representaba una sesión verificable ni se usaba en el guard.

## Rutas públicas

| Ruta | Comportamiento |
|---|---|
| `/login` | Login Firebase email/password. Si ya existe sesión, redirige a `/home`. |
| `/` | Redirige a `/home`; el guard enviará a login si no existe sesión. |

No hay otras rutas públicas intencionales.

## Rutas protegidas

Todas estas rutas pasan por el mismo `RequireAuth`:

- `/home`
- `/RegistrarElemento`
- `/registrar-asistencia`
- `/Scanner`
- `/RegistrarPago`
- `/PanelAdmin`
- `/Estadisticas`
- `/ModuloInfo`
- `/ModuloPagos`
- `/ModuloAsistencias`

Cuando `authStatus` es `loading`, se muestra “Verificando sesión...” y no se decide todavía una redirección. Cuando no existe una sesión autenticada, el guard redirige a `/login` y conserva la ubicación solicitada en el estado del router. Después de un login correcto, la aplicación regresa a esa ubicación.

Las rutas `/ModuloInfo`, `/ModuloPagos` y `/ModuloAsistencias` se conservaron para no romper enlaces existentes, pero ahora redirigen a `/PanelAdmin`. Esos componentes necesitan la prop `data`, que solo obtiene el panel después de seleccionar un elemento; renderizarlos directamente producía vistas vacías o incompletas.

## Logout

`AuthenticatedShell` envuelve todas las rutas privadas y muestra la identidad normalizada y el botón “Cerrar sesión”. El botón ejecuta el logout real de Firebase y reemplaza la ruta actual por `/login`. Por estar en el shell y no solo en la navegación inferior, también está disponible en escáner, pagos y panel administrativo.

## Dependencias que siguen siendo Firebase

- Inicialización del SDK en `src/firebase.js`.
- Persistencia de sesión en la pestaña/ventana mediante `browserSessionPersistence`.
- Login con `signInWithEmailAndPassword`.
- Observación con `onAuthStateChanged`.
- Logout con `signOut`.
- Emisión de token con `getIdToken` a través del adaptador.

Ninguna página, guard o layout importa Firebase directamente. Para migrar a OTP, se podrá reemplazar el adaptador/proveedor manteniendo el contrato de `useAuth`, siempre que el nuevo mecanismo produzca una sesión normalizada equivalente.

## Preparación para OTP

Esta fase deja listos:

- Un modelo de sesión independiente de `FirebaseUser`.
- Un estado explícito de hidratación/autenticación.
- Guards que solo conocen la interfaz neutral.
- Login y logout consumiendo métodos del contexto, no el SDK.
- Un punto único para obtener credenciales futuras.
- Retorno a la ruta solicitada después de autenticar.

No se añadieron pantallas, endpoints, `challengeId`, códigos de correo ni lógica OTP. El login sigue siendo email/password.

## Límites de esta fase

La protección implementada es una frontera de navegación del frontend. **No equivale a autorización server-side.** Continúa pendiente:

1. Confirmar cómo cada webhook valida identidad y permisos.
2. Acordar si y cómo se enviará un token de acceso sin cambiar accidentalmente los contratos actuales.
3. Validar la credencial en el receptor; ocultar una ruta o una URL no es suficiente.
4. Definir roles y permisos reales. No se inventaron roles porque el modelo actual no los proporciona.
5. Aplicar autorización por operación, especialmente lectura de datos, cobros y borrados.
6. Definir expiración, renovación y revocación para la futura sesión OTP.
7. Incorporar controles server-side de rate limit, auditoría e idempotencia.

Hasta resolver esos puntos, una persona puede quedar bloqueada por la interfaz, pero el repositorio por sí solo no demuestra que los endpoints externos rechacen una invocación directa.

## Archivos principales

- `src/services/auth/firebaseAuth.js`: adaptador Firebase actual.
- `src/contexts/AuthContext.jsx`: estado y operaciones neutrales.
- `src/contexts/authContext.js`: objeto de contexto.
- `src/hooks/useAuth.js`: consumo seguro del contexto.
- `src/components/RequireAuth.jsx`: guard único.
- `src/components/AuthenticatedShell.jsx`: identidad y logout global.
- `src/pages/Login.jsx`: login actual y retorno de navegación.
- `src/App.jsx`: mapa de rutas públicas/protegidas.
