# Actualización integral UI/UX

## Criterio visual

La interfaz adopta un lenguaje administrativo sobrio y predecible. La prioridad es que un operador pueda reconocer rápidamente el contexto, el dato relevante y la siguiente acción sin depender de color decorativo.

Principios aplicados:

- Fondo azul profundo con superficies ligeramente elevadas y bordes discretos.
- Amarillo PDMU reservado para acciones principales, navegación activa y datos destacados.
- Tipografía de sistema para carga rápida y legibilidad consistente entre plataformas.
- Jerarquía estable: contexto, título, descripción, contenido y acciones.
- Radios, alturas de control, espaciado y estados centralizados mediante tokens CSS.
- Sombras contenidas; la separación se comunica principalmente con bordes y contraste.
- Transiciones breves y respeto de `prefers-reduced-motion`.

## Sistema visual

`src/styles/ui.css` concentra:

- Colores de fondo, superficie, borde, texto, éxito, peligro y acento.
- Escala de espaciado.
- Radios, sombras y dimensiones del shell.
- Controles de formulario y botones base.
- `PageHeader`, superficies, mensajes, estados vacíos/carga y diálogos.
- Foco visible, disabled y reducción de movimiento.

Componentes UI utilizados:

- `PageHeader`: contexto, título, descripción y acciones de página.
- `StatusMessage`: éxito, información o error con `aria-live`.
- `LoadingState` y `EmptyState`: estados consistentes.
- `ConfirmDialog`: confirmación accesible para acciones destructivas o persistentes.

No se añadió ninguna biblioteca visual ni se reinstaló Tailwind.

## Navegación

Todas las rutas autenticadas ahora viven dentro del mismo shell:

- **Desktop:** encabezado global y barra lateral persistente.
- **Mobile/tablet angosta:** encabezado compacto y navegación inferior de cinco destinos.
- Destinos principales: Inicio, Inscripciones, Pagos, Asistencias y Administración.
- Estadísticas se mantiene como destino secundario en desktop y como acción desde Inicio.
- El estado activo utiliza fondo y texto de acento, no solo color del icono.
- El correo del operador y el cierre de sesión permanecen visibles sin competir con el contenido.

Este cambio conserva las URLs y la protección existente de rutas.

## Vistas actualizadas

### Login OTP

- Branding contenido en una tarjeta de acceso.
- Microcopy orientado a operador y mensaje neutral sobre el envío.
- Diferenciación clara entre identificación y verificación.
- Errores y respuestas mediante estados comunes.
- Nota de acceso restringido sin exponer detalles del proveedor.

El flujo Supabase correo → OTP, `shouldCreateUser: false` y `verifyOtp` no cambiaron.

### Inicio / Dashboard

- Encabezado ejecutivo y acciones frecuentes.
- Métricas organizadas en grid adaptable.
- Alertas y actividad en dos columnas de seguimiento.
- Principio PDMU reducido a un elemento institucional secundario.
- Se eliminaron botones flotantes que ocultaban contenido y eran poco descriptivos.

### Inscripciones

- Progreso de tres pasos con estados activo/completo.
- Campos con labels visibles y controles uniformes.
- Documentos presentados como unidades individuales con selector delimitado.
- Overlay de envío con estado textual.
- En móvil, el indicador reduce texto antes de comprimir controles.

No se modificó la preparación de `FormData` ni los nombres de campo.

### Pagos

- Progreso Elemento → Periodo → Confirmación.
- Elemento seleccionado y total presentados como resumen verificable.
- Meses en grid de botones con estado `aria-pressed`.
- Acción secundaria y primaria visualmente diferenciadas.
- Layout adaptado a 320 px sin comprimir botones ni textos.

Los payloads de pago permanecen intactos.

### Asistencia manual

- Captura centrada en una única tarea con label e instrucción.
- Envío mediante formulario, por lo que Enter también confirma.
- Alternativa QR separada de la acción principal.

### Scanner QR

- Estados explícitos: cámara activa, procesamiento y escaneo finalizado.
- Instrucciones de encuadre y buena iluminación.
- Cámara y actividad de sesión distribuidas en dos columnas cuando hay espacio.
- Resultados con estado textual e icono; lista preparada para scroll.
- Mensajes de cámara/red dentro de la vista.

### Administración

- Búsqueda presentada como entrada al expediente.
- Identidad e ID del elemento visibles durante toda la consulta.
- Información, Pagos y Asistencias funcionan como navegación contextual.
- “Cambiar elemento” se mantiene junto a navegación; eliminación se separa en una zona destructiva discreta.
- Se evita mostrar datos anteriores durante la carga de otro módulo.

### Información del expediente

- Separación en Datos personales, Tutor/contacto y Documentos.
- Grid de dos columnas en desktop y una en móvil.
- Edición por campo con acciones locales.
- Estado documental y carga visibles sin dominar la pantalla.

### Historial de pagos

- Resumen de elemento, identificador y mensualidades cubiertas.
- Grid de 12 periodos adaptable a 3, 2 o 1 columna.
- Badges de estado y expansión por registro.
- Edición y eliminación con jerarquía consistente.

### Historial de asistencias

- Resumen de expediente y conteo de registros.
- Tabla de alta densidad con encabezado sticky y scroll controlado.
- Acciones compactas, estado editable y confirmación consistente.
- El contenedor permite uso con muchos registros sin expandir indefinidamente la página.

### Estadísticas

- Placeholder empresarial con explicación de dependencia funcional.
- Estructura preparada para tendencias, periodos y reportes.
- Evita presentar una pantalla vacía como funcionalidad terminada.

## Responsive y accesibilidad

Se contemplan explícitamente 320/360/390 px, tablet y desktop:

- Shell cambia a sidebar desde 900 px.
- Grids reducen columnas progresivamente.
- Tablas usan scroll horizontal y vertical delimitado.
- Botones principales mantienen al menos 44 px de altura; acciones compactas mantienen 36–40 px dentro de tablas.
- Modales apilan acciones en móvil.
- Labels visibles en flujos de captura.
- Foco visible de alto contraste.
- Navegación, meses, resultados y expansores usan elementos semánticos.
- Iconos decorativos tienen `aria-hidden` y las acciones conservan nombre textual.
- Errores y confirmaciones usan regiones anunciables.

## Decisiones funcionales preservadas

- No se modificaron servicios, payloads o URLs de workflows.
- No se modificó Supabase Auth ni el contrato OTP.
- No se añadieron llamadas a tablas Supabase.
- No se añadió `Authorization` a n8n.
- No se migraron datos ni se cambiaron reglas de negocio.

## Prueba manual recomendada

Probar al menos en 320, 390, 768 y 1280 px:

1. Solicitar, reenviar y verificar OTP; probar error y cambio de correo.
2. Navegar por los cinco destinos y confirmar estado activo.
3. Completar los tres pasos de inscripción con nombres de archivo largos.
4. Seleccionar 1 y 12 mensualidades y revisar el resumen.
5. Registrar asistencia manual con Enter y mediante botón.
6. Permitir y denegar cámara; completar varios escaneos.
7. Buscar un expediente, alternar rápidamente entre módulos y cambiar de elemento.
8. Editar/cancelar datos, pago y asistencia; probar confirmaciones destructivas.
9. Revisar navegación completa solo con teclado.
10. Probar textos largos y zoom del navegador al 200 %.

## Deuda UI/UX pendiente

- Validación visual en dispositivos físicos y navegadores Safari iOS/Chrome Android.
- Pruebas automatizadas de accesibilidad y regresión visual.
- Investigación con operadores para validar densidad, vocabulario y orden de tareas.
- Skeletons específicos por vista si la latencia real lo justifica.
- Paginación o virtualización cuando historiales superen el volumen actual.
- Optimización del archivo JPEG del logo y variantes de marca preparadas para fondo oscuro.
- Diseño de roles/permisos cuando exista autorización real; ocultar acciones en UI no sustituye seguridad server-side.
