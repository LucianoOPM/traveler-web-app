import { describe, expect, test } from "bun:test";
import { jpeg, pdf, pdfDe, png, webp } from "../../support/imagenes";
import { detectarTipoEvidencia, detectarTipoImagen } from "@modules/media/domain/firma";

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

describe("detectarTipoEvidencia (imágenes y PDF)", () => {
  test("reconoce imágenes y un PDF con cabecera y cierre", () => {
    expect(detectarTipoEvidencia(jpeg())).toBe("image/jpeg");
    expect(detectarTipoEvidencia(pdf())).toBe("application/pdf");
    expect(detectarTipoEvidencia(pdfDe(5 * 1024 * 1024))).toBe("application/pdf");
  });

  test("las portadas siguen siendo solo imágenes: un PDF no es imagen", () => {
    expect(detectarTipoImagen(pdf())).toBeNull();
  });

  test("rechaza un PDF truncado, sin cierre en el último kilobyte o con firma falsa", () => {
    expect(detectarTipoEvidencia(pdf().slice(0, 15))).toBeNull(); // truncado
    const sinCierre = new TextEncoder().encode("%PDF-1.4\n" + "x".repeat(2000));
    expect(detectarTipoEvidencia(sinCierre)).toBeNull();
    // El cierre existe pero fuera del último kilobyte.
    const lejos = new TextEncoder().encode("%PDF-1.4\n%%EOF\n" + "x".repeat(3000));
    expect(detectarTipoEvidencia(lejos)).toBeNull();
    // Cabecera falsa (HTML o texto con extensión .pdf) y cierre válido.
    expect(detectarTipoEvidencia(new TextEncoder().encode("<html>%%EOF</html>......"))).toBeNull();
    expect(detectarTipoEvidencia(new TextEncoder().encode("%PD-1.4 contenido %%EOF"))).toBeNull();
    expect(detectarTipoEvidencia(new Uint8Array())).toBeNull();
  });
});
