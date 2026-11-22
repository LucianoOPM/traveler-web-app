# 03 — Arquitectura

## Estilo
**Monolito modular full-stack** en Astro con componentes React donde exista interacción. Bun ejecuta aplicación y scripts. PostgreSQL con Drizzle mantiene el estado persistente. Archivos privados se guardan en disco local fuera del directorio público.

```mermaid
flowchart TB
  B[Comprador / catálogo] --> A[Astro: páginas y API]
  P[Admin / operador] --> A
  V[Visitante demo] --> A
  A --> G[Autenticación y autorización]
  G --> S[Servicios de aplicación por módulo]
  S --> D[(PostgreSQL privado o demo)]
  S --> F[(Archivos locales privados)]
  S --> U[Auditoría]
```

## Separación de responsabilidades
- **Rutas Astro / endpoints:** parsean entrada, validan sesión, ejecutan política, llaman al caso de uso, construyen respuesta.
- **React islands:** formularios, filtros, editor, escáner y componentes interactivos; no guardan secretos ni implementan autorización real.
- **Servicios de aplicación:** transacciones y coordinación de casos de uso.
- **Dominio:** invariantes, cálculos monetarios, transiciones y políticas.
- **Repositorios Drizzle:** acceso persistente; no toman decisiones de permisos.
- **Infraestructura:** Better Auth, storage local, generación de QR, render de flyers.

## Módulos
`identity`, `catalog`, `bookings`, `payments`, `tickets`, `operations`, `marketing`, `demo`, `audit`.

## Aislamiento de datos
Se recomienda una misma instancia PostgreSQL Docker con **dos bases distintas** (`traveltech_private`, `traveltech_demo`) y migraciones idénticas. Los datos semilla solo se cargan en la base demo. La selección de conexión ocurre en servidor mediante contexto autenticado y rutas permitidas; nunca se acepta un nombre de base enviado por cliente. El acceso administrativo privado no debe mezclarse con sesiones de visitante.

## Flujo: reserva
```mermaid
sequenceDiagram
  participant C as Comprador
  participant API as API
  participant B as BookingService
  participant DB as PostgreSQL
  C->>API: Solicitar reserva
  API->>B: Datos validados
  B->>DB: BEGIN + bloquear capacidad
  DB-->>B: Disponibilidad
  B->>DB: Insertar reserva, pasajeros y retención
  B->>DB: COMMIT
  API-->>C: Referencia + token seguro
```

## Flujo: pago y abordaje
```mermaid
flowchart LR
  R[Reserva activa] --> E[Comprobante recibido]
  E --> A[Revisión administrativa]
  A -->|Rechazo| E
  A -->|Pago verificado y liquidación completa| T[Boletos individuales]
  T --> V[Validación QR]
  V -->|Operador autorizado| C[Registro único de abordaje]
```

## Convenciones técnicas
- Importes en centavos enteros, sin floats.
- UUID para claves; códigos legibles separados de IDs internos.
- Fechas persistidas con zona/instantes UTC y zona de agencia para calendarios.
- Transacciones con bloqueos/actualizaciones condicionales para capacidad y asignaciones.
- Restricciones únicas en BD para operaciones que no pueden duplicarse.
- Errores tipados; mensajes públicos sin información interna.
- Registro de auditoría en la misma transacción cuando sea necesario.

## Decisiones de integración aplazadas
Correo real, almacenamiento de objetos, colas, cron productivo, IA, pagos en línea y hosting. Definir interfaces de adaptadores para poder incorporarlos sin cambiar reglas del dominio.
