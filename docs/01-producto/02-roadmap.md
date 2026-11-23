# 02 — Roadmap de desarrollo

**Método:** hitos verificables, sin fechas artificiales. La secuencia prioriza dependencias técnicas; algunas interfaces pueden avanzar en paralelo.

## H0 — Preparación y disciplina
**Entregables:** repositorio, `docs/`, configuración de entorno, scripts reproducibles, formato/lint, pruebas base, manejo de errores, variables de entorno y convenciones de commits.
**Salida:** cualquier integrante puede instalar y ejecutar una prueba de salud local.

## H1 — Plataforma y autenticación
**Entregables:** Astro full-stack, React islands, Bun, PostgreSQL Docker con volumen, Drizzle/migraciones, Better Auth con Admin plugin, administrador inicial por script, rutas protegidas, layout administrativo.
**Salida:** login de administrador; usuario no autenticado no accede a `/admin`; primera migración (identidad) aplicada y verificada sobre `traveltech_test`; las pruebas destructivas solo pueden ejecutarse en esa base ([ADR-023](../05-decisiones/11-decisions-and-risks.md)).

## H2 — Catálogo y capacidad
**Entregables:** paquetes CRUD, salidas CRUD, tarifas por categoría, puntos de abordaje, imágenes locales, catálogo público, validaciones y transacciones de inventario.
**Salida:** crear y publicar un paquete con varias salidas; comprobar capacidad y precios desde catálogo.

## H3 — Reservaciones
**Entregables:** checkout invitado, pasajeros, reserva transaccional, token de consulta, plazo configurable, expiración y retención por comprobante en revisión, cancelación/reactivación con auditoría.
**Salida:** dos solicitudes concurrentes no sobrevenden; reserva vencida se reactiva solo si hay capacidad.

## H4 — Pagos y cuentas
**Entregables:** tres cuentas ficticias configurables, asignación por prioridad/límite mensual, instrucciones inmutables, evidencias privadas, revisión SPEI, reemplazo de comprobantes, efectivo admin, historial y conciliación.
**Salida:** comprobante rechazado no suma ingresos; ausencia de cuenta elegible crea alerta; concurrencia respeta límites; pagos parciales suman neto sin sobrepago; la reserva con pagos verificados no expira; la asignación se libera solo en los casos de [ADR-029](../05-decisiones/11-decisions-and-risks.md).

## H5 — Boletos y operaciones
**Entregables:** QR de reserva, emisión de boletos individuales tras pago completo, consulta/validación, manifiestos, escáner móvil, abordaje atómico, historial.
**Salida:** un QR individual válido aborda una sola vez; QR de reserva no aborda; operador no accede a pagos.

## H6 — Marketing y seed completo
**Entregables:** plantillas, proyectos, edición de textos/paletas/imágenes, exportación cuadrada y vertical, seed completo (volúmenes en [08-demo-seed-and-content](../03-demo/08-demo-seed-and-content.md)); comprobación de consistencia.
**Salida:** seed repetible y auditado; imágenes y precios de flyers corresponden a salidas; sin proveedor IA obligatorio.

## H7 — Demo de visitantes
**Entregables:** base de datos de demo aislada, invitaciones de un uso, sesión de 2 h, watermark único, lectura ficticia, formularios locales, aviso de no guardado, QR consultable sin check-in, denegación de escritura en servidor.
**Salida:** pruebas de abuso de endpoints pasan; ningún dato privado aparece en demo; enlace usado no puede reutilizarse.

## H8 — Endurecimiento y entrega
**Entregables:** pruebas integrales, accesibilidad, observabilidad local, respaldo/restauración, documentación operativa, validación de datos semilla, revisión de privacidad.
**Salida:** recorrido completo reproducible y checklist de aceptación firmado.

## Orden de prioridades
**P0:** inventario, autorización, dinero, integridad, privacidad. **P1:** experiencia de usuario y operaciones completas. **P2:** refinamientos visuales y automatizaciones no esenciales.

## Política de cierre de hito
No cerrar un hito por capturas de pantalla: exigir funcionalidad, prueba automatizada, migración, errores controlados y documentación actualizada.
