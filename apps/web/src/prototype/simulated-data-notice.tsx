// PROTÓTIPO (F1-50). Aviso obrigatório em toda tela com dado falso.

export function SimulatedDataNotice() {
  return (
    <aside
      aria-label="Aviso de dados simulados"
      className="rounded-md border-2 border-dashed border-amber-600 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-50"
    >
      <p>
        <strong className="font-semibold">Dados simulados.</strong> Este dashboard é um protótipo: os números são
        falsos, fixos no código, e não vêm da sua conta. O “hoje” do protótipo é 9 de novembro de 2026.
      </p>
    </aside>
  );
}
