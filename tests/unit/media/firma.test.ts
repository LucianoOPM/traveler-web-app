import { describe, expect, test } from "bun:test";
import { jpeg, png, webp } from "../../support/imagenes";
import { detectarTipoImagen } from "../../../src/modules/media/domain/firma";

describe("detectarTipoImagen", () => {
  test("reconoce jpeg, png y webp por su firma", () => {
    expect(detectarTipoImagen(jpeg())).toBe("image/jpeg");
    expect(detectarTipoImagen(png())).toBe("image/png");
    expect(detectarTipoImagen(webp())).toBe("image/webp");
  });

  test("rechaza vacío, texto, HTML y SVG aunque se renombren", () => {
    expect(detectarTipoImagen(new Uint8Array())).toBeNull();
    for (const contenido of ["hola", "<html><script>1</script></html>", "<svg xmlns='x'></svg>"]) {
      expect(detectarTipoImagen(new TextEncoder().encode(contenido))).toBeNull();
    }
  });

  test("rechaza archivos truncados", () => {
    expect(detectarTipoImagen(jpeg().slice(0, 6))).toBeNull();
    expect(detectarTipoImagen(png().slice(0, 20))).toBeNull();
    expect(detectarTipoImagen(webp().slice(0, 14))).toBeNull();
  });

  test("rechaza un webp cuyo tamaño RIFF no coincide", () => {
    const roto = webp();
    roto[4] = 99;
    expect(detectarTipoImagen(roto)).toBeNull();
  });
});
