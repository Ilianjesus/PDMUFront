# Iteración UI/UX 1

## Objetivo

Hacer que las tareas operativas se entiendan por jerarquía, iconos y patrones conocidos, con menos decisiones y menos texto de apoyo. Esta iteración no modifica reglas de negocio, datos ni automatizaciones.

## Auditoría

### Hallazgos de mayor impacto

1. **Asistencia fragmentada.** Para una actividad nueva había que abrir un modal, elegir el tipo, crear la sesión, elegir QR y activar la cámara. Además, cada QR detenía el flujo.
2. **Acción principal poco dominante.** QR y registro manual tenían el mismo peso, aunque el QR es el mecanismo principal del producto.
3. **Repetición innecesaria.** Las actividades recurrentes requerían reconstruir el contexto en cada jornada.
4. **Estado del escáner verboso.** La cámara, el estado de procesamiento y los resultados competían por atención.
5. **Inconsistencia potencial.** Las vistas restantes ya comparten encabezado, controles, navegación y estados vacíos; conviene conservar ese sistema y mejorar primero el recorrido de mayor frecuencia antes de introducir otro lenguaje visual.

## Cambios aplicados

- Inicio rápido de Instrucción, Natación y Atletismo desde la vista de asistencia.
- Creación o reutilización automática de la sesión del día.
- Entrada directa al escáner con la sesión seleccionada.
- QR elevado a acción primaria y registro manual conservado como alternativa.
- Cámara iniciada automáticamente cuando el recorrido proviene de inicio rápido.
- Escaneo continuo: después de registrar un código, el lector se reanuda sin intervención.
- Resultados recientes mostrados primero y contador visible.
- Etiquetas e instrucciones del escáner reducidas.
- Iconografía consistente para actividades, QR y captura manual.

## Medición del recorrido

| Tarea | Antes | Ahora |
| --- | ---: | ---: |
| Empezar actividad recurrente | 4 decisiones | 1 decisión |
| Preparar cámara después de elegir actividad | 1 acción adicional | Automático |
| Registrar el siguiente QR | 1 acción adicional | Automático |
| Identificar método recomendado | Dos acciones equivalentes | QR primario, manual secundario |

## Criterios para las siguientes vistas

- Una acción primaria por contexto.
- Acciones frecuentes visibles; acciones administrativas o destructivas en segundo nivel.
- Máximo una frase breve bajo el título cuando sea necesaria.
- Iconos siempre acompañados por etiqueta cuando su significado no sea universal.
- Estados vacíos con una sola salida clara.
- Formularios divididos por decisiones del usuario, no por estructura de la base de datos.
- En móvil, la acción siguiente debe permanecer dentro del primer recorrido visual siempre que sea posible.

## Próxima prioridad sugerida

1. Pagos: registro desde la lista de pendientes sin búsqueda duplicada.
2. Expedientes: resumen del elemento y acciones frecuentes antes de los detalles editables.
3. Inscripción: captura progresiva con resumen persistente de avance.
4. Reportes: separar seguimiento operativo de análisis histórico.
