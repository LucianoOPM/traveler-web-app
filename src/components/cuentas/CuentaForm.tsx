import { actions } from "astro:actions";
import { Button } from "@components/ui/button";
import { useState } from "react";
import { Campo, ErrorGeneral, useEnvio } from "@components/catalogo/comun";
import { centavosAPesos, pesosACentavos } from "@lib/importes";
import type { BankAccount } from "@modules/payments/types";

/** Crea (sin `cuenta`) o edita una cuenta y, al editar, la habilita, deshabilita o elimina. */
export default function CuentaForm({ cuenta }: { cuenta?: BankAccount }) {
  const [name, setName] = useState(cuenta?.name ?? "");
  const [bankName, setBankName] = useState(cuenta?.bankName ?? "");
  const [accountHolder, setAccountHolder] = useState(cuenta?.accountHolder ?? "");
  const [clabe, setClabe] = useState(cuenta?.clabe ?? "");
  const [priority, setPriority] = useState(String(cuenta?.priority ?? ""));
  const [limite, setLimite] = useState(cuenta ? centavosAPesos(cuenta.monthlyLimitCents) : "");
  const { errores, enviando, ejecutar } = useEnvio();

  async function guardar(evento: React.FormEvent) {
    evento.preventDefault();
    // La conversión pesos → centavos vive en `@lib/importes`; las reglas de la cuenta, en el servicio.
    const previos: Record<string, string> = {};
    const monthlyLimitCents = pesosACentavos(limite);
    if (monthlyLimitCents === null) previos.monthlyLimitCents = "Escribe un importe válido";
    const prioridad = priority.trim() === "" ? NaN : Number(priority);
    if (!Number.isInteger(prioridad)) previos.priority = "Escribe un número entero";
    const datos = {
      name,
      bankName,
      accountHolder,
      clabe,
      priority: prioridad,
      monthlyLimitCents: monthlyLimitCents ?? 0,
    };
    const guardada = await ejecutar(
      () =>
        cuenta
          ? actions.payments.editAccount({ id: cuenta.id, ...datos })
          : actions.payments.createAccount(datos),
      previos,
    );
    if (!guardada) return;
    if (cuenta) location.reload();
    else location.assign(`/admin/cuentas/${guardada.id}`);
  }

  async function cambiarElegibilidad() {
    if (!cuenta) return;
    const ok = await ejecutar(() =>
      actions.payments.setAccountEligible({ id: cuenta.id, isEligible: !cuenta.isEligible }),
    );
    if (ok) location.reload();
  }

  async function eliminar() {
    if (!cuenta || !confirm("¿Eliminar esta cuenta?")) return;
    if (await ejecutar(() => actions.payments.deleteAccount({ id: cuenta.id }))) {
      location.assign("/admin/cuentas");
    }
  }

  return (
    <form onSubmit={guardar} noValidate>
      <Campo
        id="cuenta-name"
        name="name"
        etiqueta="Nombre"
        value={name}
        onValor={setName}
        error={errores.campos.name}
      />
      <Campo
        id="cuenta-bank"
        name="bankName"
        etiqueta="Banco"
        value={bankName}
        onValor={setBankName}
        error={errores.campos.bankName}
      />
      <Campo
        id="cuenta-holder"
        name="accountHolder"
        etiqueta="Titular"
        value={accountHolder}
        onValor={setAccountHolder}
        error={errores.campos.accountHolder}
      />
      <Campo
        id="cuenta-clabe"
        name="clabe"
        etiqueta="CLABE (18 dígitos)"
        inputMode="numeric"
        autoComplete="off"
        value={clabe}
        onValor={setClabe}
        error={errores.campos.clabe}
      />
      <Campo
        id="cuenta-priority"
        name="priority"
        etiqueta="Prioridad (menor número = primero)"
        inputMode="numeric"
        value={priority}
        onValor={setPriority}
        error={errores.campos.priority}
      />
      <Campo
        id="cuenta-limit"
        name="monthlyLimitCents"
        etiqueta="Límite mensual (pesos)"
        inputMode="decimal"
        value={limite}
        onValor={setLimite}
        error={errores.campos.monthlyLimitCents}
      />
      <ErrorGeneral mensaje={errores.general} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={enviando}>
          {cuenta ? "Guardar cambios" : "Crear cuenta"}
        </Button>
        {cuenta && (
          <>
            <Button
              type="button"
              variant="outline"
              disabled={enviando}
              onClick={cambiarElegibilidad}
            >
              {cuenta.isEligible ? "Deshabilitar" : "Habilitar"}
            </Button>
            <Button type="button" variant="destructive" disabled={enviando} onClick={eliminar}>
              Eliminar
            </Button>
          </>
        )}
      </div>
    </form>
  );
}
