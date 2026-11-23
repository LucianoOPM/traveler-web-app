/** Única respuesta `404` de las páginas públicas: inexistente, inválido o no publicado se ven igual. */
export const noEncontrado = () =>
  new Response("No encontrado", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
