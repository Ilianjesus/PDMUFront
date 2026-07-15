# Plan de migración Google Sheets → Supabase

## Principio de migración

La migración será incremental por verticales. React seguirá consumiendo n8n y ningún componente escribirá simultáneamente en Sheets/Supabase. La convivencia y el dual-write, cuando se implemente, pertenecen a n8n o a una capa server-side con idempotencia.

No se elimina ni se modifica el legado hasta cumplir criterios de conciliación y disponer de rollback.

## Fase 0 — inventario, respaldo y perfilado

1. Congelar una definición de columnas y catálogos de cada Sheet.
2. Exportar snapshots inmutables con timestamp y checksum.
3. Contar filas, IDs únicos, vacíos y duplicados.
4. Identificar formatos reales de fechas, cantidades, teléfonos y URLs.
5. Crear archivo de excepciones; ningún registro inválido se descarta silenciosamente.
6. Confirmar zona horaria, tarifa/método y reglas de estados.

Entregables:

- Snapshot por hoja.
- Reporte de calidad.
- Catálogos de mapeo aprobados.
- Plan de rollback y responsables.

## Fase 1 — crear estructura Supabase

1. Revisar la migración SQL en un proyecto de desarrollo.
2. Aplicar `202606290001_business_schema_v1.sql`.
3. Confirmar tablas, FKs, checks, índices, triggers, RLS y grants.
4. Crear operadores de prueba vinculados con `auth.users`.
5. Comprobar que `anon` y `authenticated` no puedan acceder directamente.
6. Preparar credencial server-side para n8n fuera del frontend y del repositorio.

Criterio de salida: esquema reproducible y pruebas de permisos correctas.

## Fase 2 — importar elementos

1. Transformar encabezados Sheets a campos canónicos.
2. Normalizar espacios, vacíos, teléfonos, fechas y códigos.
3. Generar UUID para cada elemento.
4. Conservar `ID` como `element_code`.
5. Crear y resguardar un crosswalk:

```text
legacy_element_code → elements.id
```

6. Importar primero sin documentos.
7. Enviar filas inválidas a excepciones con motivo.

Validaciones:

- Total origen = importados + excepciones justificadas.
- `element_code` únicos y no vacíos.
- Ninguna fecha futura/no parseable sin excepción.
- Nombres/tutores obligatorios presentes.
- QR y carpeta Drive sin colisiones inesperadas.

## Fase 3 — importar documentos como metadata

Por cada una de las seis columnas documentales:

1. Ignorar únicamente vacíos/valores canónicos “sin documento”.
2. Resolver `element_id` con el crosswalk.
3. Clasificar `document_type`.
4. Extraer Drive file ID cuando sea posible.
5. Conservar URL original y nombre/MIME/tamaño cuando puedan obtenerse de forma confiable.
6. Crear una fila activa versión 1.
7. Registrar URL inválida, duplicada o inaccesible como excepción.

No mover bytes en esta fase. Drive continúa siendo almacenamiento y Supabase conserva metadata.

Validaciones:

- Conteo por tipo: valores válidos en Sheets = filas importadas.
- Ningún documento sin elemento.
- Máximo una revisión activa por elemento/tipo.
- Lista completa de enlaces no resolubles.

## Fase 4 — importar pagos

1. Resolver `ID Elemento` al UUID interno.
2. Conservar `ID Pago` como `payment_code`.
3. Mapear mes a entero y año a integer.
4. Convertir cantidad a centavos con una regla determinista.
5. Normalizar método.
6. Parsear fecha en zona acordada y convertir a UTC.
7. Importar como `posted`, versión 1.

No corregir automáticamente duplicados. Clasificarlos:

- Duplicado exacto.
- Mismo elemento/año/mes con diferente ID.
- Mismo periodo con monto/método diferente.
- Pago sin elemento.

La restricción única impedirá importar conflictos activos; deben resolverse o quedar en tabla/archivo de excepciones antes del cutover.

## Fase 5 — importar asistencias

1. Resolver elemento mediante código.
2. Conservar `ID Asistencia`.
3. Validar nombres duplicados contra el elemento solo para detectar discrepancias.
4. Parsear fecha/hora con zona explícita.
5. Derivar `attendance_date` en Ciudad de México.
6. Mapear estado al catálogo nuevo.
7. Importar con `source = legacy_import`, `record_status = active`, versión 1.

Registros sin elemento, fecha inválida, ID repetido o estado desconocido quedan como excepciones.

## Fase 6 — conciliación integral

### Conteos obligatorios

| Control | Regla |
|---|---|
| Elementos | Filas válidas origen = `elements` importados. |
| Pagos | Filas válidas origen = `payments` importados. |
| Asistencias | Filas válidas origen = `attendance_records` importados. |
| Documentos | Valores documentales válidos = `element_documents` importados. |
| Excepciones | Origen = importados + excepciones documentadas. |

### Integridad referencial

- Cero pagos sin `element_id`.
- Cero asistencias sin `element_id`.
- Cero documentos sin `element_id`.
- Cero IDs de negocio vacíos o duplicados no resueltos.
- Cero pagos activos duplicados por elemento/año/mes.
- Cero documentos activos duplicados por elemento/tipo.

### Conciliación semántica

- Muestreo de nombres/tutores/fechas contra Sheets.
- Suma de `amount_cents` por año/mes versus Sheets.
- Conteo de asistencias por fecha/status versus Sheets.
- Conteo documental por tipo.
- URLs/IDs Drive accesibles según política.
- Timestamps convertidos a la fecha operativa esperada.

### Evidencia

Guardar reportes con:

- Fecha y snapshot origen.
- Query/script y versión.
- Conteo origen/destino/excepciones.
- Diferencias antes/después de resolución.
- Aprobación del dueño del dato.

## Fase 7 — ejecución paralela temporal

Orden seguro:

1. **Carga inicial:** Sheets sigue siendo autoridad; Supabase es sombra.
2. **Shadow write server-side:** n8n escribe ambos destinos usando la misma idempotency key. React no hace dual-write.
3. **Conciliación continua:** comparar cada operación y ejecutar reporte diario.
4. **Shadow read:** workflows consultan Supabase internamente y comparan con Sheets sin cambiar la respuesta a React.
5. **Lectura por vertical:** activar Supabase como lectura de un dominio mediante feature flag server-side.
6. **Escritura por vertical:** Supabase pasa a autoridad; Sheets recibe exportación/replicación temporal.
7. **Ventana de estabilización:** monitorizar errores, latencia y diferencias.

Evitar dual-write sin transacción lógica: si un destino falla, guardar operación pendiente/reparable y no responder éxito ambiguo.

## Fase 8 — migrar workflows por dominio

Orden sugerido:

1. `pdmu-elements`: búsqueda y consulta por UUID/código; después create/update.
2. `pdmu-dashboard`: lecturas agregadas desde Supabase.
3. `pdmu-payments`: list/create/correct/cancel con restricción e idempotencia.
4. `pdmu-attendance`: list/create/correct/cancel.
5. Documentos y aprovisionamiento Drive/QR.

Cada vertical debe:

- Implementar el contrato n8n v2.
- Validar JWT/rol server-side.
- Registrar `audit_log`.
- Usar `idempotency_keys` en comandos.
- Dejar de enviar/aceptar `sheet`, `operacion` y `row_number`.
- Tener feature flag y ruta de rollback.

## Fase 9 — cutover y apagado legacy

Antes del cutover:

- Conciliación en cero o excepciones formalmente aceptadas.
- Backups y restauración probados.
- Métricas/alertas operativas.
- Runbook de rollback.
- Periodo de soporte definido.

Cutover:

1. Pausar brevemente escrituras o establecer una marca de corte.
2. Ejecutar delta final desde Sheets.
3. Conciliar conteos/checksums.
4. Cambiar Supabase a autoridad.
5. Mantener exportación a Sheets de solo lectura durante la ventana acordada.

Apagado:

- Desactivar escrituras legacy, no borrar hojas.
- Revocar credenciales de escritura cuando termine la ventana.
- Archivar snapshots y reportes.
- Retirar endpoints/variables legacy solo en una versión posterior de React.

## Rollback

Rollback por vertical, no global:

1. Desactivar feature flag de Supabase en n8n.
2. Restaurar lectura/escritura legacy.
3. Detener replicación para no agravar diferencias.
4. Exportar operaciones Supabase desde la marca de corte.
5. Conciliar antes de reintentar.

Nunca hacer rollback copiando filas manualmente sin `request_id`/idempotency key.

## Consultas de conciliación esperadas

La implementación de scripts se hará en una fase posterior. Como mínimo deben producir:

- Conteo total y por status de cada tabla.
- IDs de elemento presentes solo en origen/destino.
- Pagos sin elemento.
- Asistencias sin elemento.
- Documentos sin elemento.
- Pagos duplicados por `(element_id, year, month)`.
- Documentos activos duplicados por `(element_id, document_type)`.
- IDs de pago/asistencia duplicados.
- Fechas/montos/estados no parseables.
- Diferencias agregadas por mes y día.

## Criterio de terminado

Sheets deja de ser fuente principal solo cuando:

- Todas las verticales activas leen/escriben Supabase.
- No hay diferencias no explicadas durante la ventana acordada.
- Backups y rollback están probados.
- n8n valida identidad/permisos y audita operaciones.
- Operadores aprobaron flujos críticos.
- Sheets queda formalmente como exportación/archivo de solo lectura.
