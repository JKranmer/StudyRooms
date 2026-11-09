import { useSearch } from '@tanstack/react-router';

import { Button } from '@/components/ui/button';
import { DashboardContent } from '@/dashboard/dashboard-content';
import { PeriodNav } from '@/dashboard/period-nav';
import { parsePeriodKind } from '@/dashboard/types';
import { SimulatedDataNotice } from '@/prototype/simulated-data-notice';
import { useSimulatedDashboard } from '@/prototype/use-simulated-dashboard';

export function DashboardPage() {
  const search = useSearch({ strict: false });
  const kind = parsePeriodKind(search.periodo) ?? 'semana';
  const query = useSimulatedDashboard(kind);

  return (
    <section aria-labelledby="titulo-dashboard" className="flex flex-col gap-6">
      <h1 id="titulo-dashboard" className="text-2xl font-semibold">
        Seu estudo
      </h1>
      <SimulatedDataNotice />
      <PeriodNav current={kind} />
      {query.isPending ? (
        <p role="status" className="text-muted-foreground">
          Carregando dados…
        </p>
      ) : query.isError ? (
        <div role="alert" className="flex flex-col items-start gap-3">
          <p>Não foi possível carregar os dados.</p>
          <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
            Tentar de novo
          </Button>
        </div>
      ) : (
        <DashboardContent data={query.data} />
      )}
    </section>
  );
}
