# 06 — Seguridad, acceso y privacidad

## Identidades independientes
- **Personal:** Better Auth + Admin plugin, registro cerrado, invitación de empleados, roles `admin` y `operator`; permisos finos de negocio en aplicación.
- **Comprador:** token de acceso limitado a su reserva; no es usuario de Better Auth.
- **Visitante demo:** invitación y sesión propias, **sin rol de personal**.

## Sesión de visitante
1. Administrador crea token aleatorio criptográficamente seguro; almacenar hash.
2. Enlace válido 24 horas, revocable, de un solo uso.
3. Abrir el enlace muestra pantalla intermedia; solo `Entrar` consume invitación, de manera atómica.
4. Crear sesión con duración de 2 horas; cookie `HttpOnly`, `SameSite` adecuado, `Secure` con HTTPS.
5. Retirar token de URL después de canjear; evitar filtrarlo en logs/referrers.
6. Vincular sesión a marca de agua anónima única; mostrarla repetida en pantallas internas.
7. Caducidad y revocación se verifican en servidor en cada solicitud protegida.

## Autorización
| Operación | Admin | Operador | Comprador | Visitante |
|---|---|---|---|---|
| CRUD catálogo | Sí | No | No | No |
| Crear reserva | Según flujo | No | Sí, su compra | No |
| Verificar pago | Sí | No | No | No |
| Ver manifiesto | Sí | Sí | No | Sí, ficticio |
| Registrar abordaje | Según permiso | Sí | No | No |
| Consultar QR | Sí | Sí | Según alcance | Sí, ficticio |
| Crear flyer | Sí | Según permiso explícito | No | No |
| Editar cuentas | Sí | No | No | No |

**Acceso al área privada (`/admin`, issue #45):** `admin` y `operator` comparten `/admin`; la guardia está en el middleware, en el servidor: sin sesión → `302` a `/login`; usuario vetado o sin rol de personal → `403`; las respuestas llevan `Cache-Control: no-store`. Entrar a `/admin` **no** concede permisos por operación: cada endpoint o página valida el rol en el servidor (por ejemplo, el operador no accede a pagos) y nunca confía en el rol enviado por el cliente.

## Aislamiento
- Dos bases de datos separadas para privado y demo, mismo esquema.
- No elegir base desde parámetros enviados por cliente.
- Denegar **todos** los métodos de escritura para visitante en servicios y endpoints, incluyendo mutaciones indirectas, exportaciones que persisten y subidas.
- Formularios de demo: validación local y aviso; ningún POST real.
- Archivos privados fuera de `public/`; servir solo mediante controlador con autorización y cabeceras apropiadas.
- **Imágenes de paquetes (#55):** la subida es una Action solo para `admin` (`401` sin sesión, `403` operador). El tipo se decide por la **firma real** del archivo (JPEG, PNG o WebP, completo y no truncado), nunca por la extensión ni por el tipo que declare el cliente; máximo 5 MiB; vacío o corrupto se rechaza. El nombre en disco es un UUID generado por el servidor y el almacén rechaza cualquier clave que salga de su raíz. La lectura es `GET /api/media/<uuid>`: resuelve el UUID a un registro (la ruta del disco no sale nunca) y solo es pública si el asset es la portada de un paquete **publicado**; el admin autenticado ve también borradores y archivados. Id inválido, inexistente o no autorizado dan el mismo `404`. Respuesta con `X-Content-Type-Options: nosniff`; `Cache-Control: public, max-age=0, must-revalidate` para portadas públicas y `no-store` para las que solo ve el admin (nada queda público en caché tras archivar un paquete).
- En demo, usar nombres, imágenes, CLABE y comprobantes sintéticos claramente identificados; no utilizar cuentas reales aunque sean parcialmente enmascaradas.

## Defensa en profundidad
Validación de entrada en servidor, CSRF según mecanismo de autenticación, cookies seguras, rate limiting para tokens y QR, consultas parametrizadas/Drizzle, cabeceras de seguridad, logs saneados, revocación, pruebas de control de acceso por ruta y API.

## Limitación explícita
Una web no puede impedir de manera fiable capturas de pantalla, inspección de JavaScript o copia de lo mostrado. Watermark y acceso temporal disuaden y facilitan trazabilidad, pero **no equivalen a DRM**.
