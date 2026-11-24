import { actions } from "astro:actions";
import { Button } from "@components/ui/button";
import { ErrorGeneral, useEnvio } from "@components/catalogo/comun";

/** Pide las instrucciones SPEI con el token del enlace; las reglas viven en el servidor. */
export default function PedirInstrucciones({ token }: { token: string }) {
  const { errores, enviando, ejecutar } = useEnvio();

  async function pedir() {
    if (await ejecutar(() => actions.payments.requestInstructions({ token }))) location.reload();
  }

  return (
    <div className="grid gap-2">
      <ErrorGeneral mensaje={errores.general} />
      <div>
        <Button type="button" disabled={enviando} onClick={pedir}>
          Pedir instrucciones SPEI
        </Button>
      </div>
    </div>
  );
}
