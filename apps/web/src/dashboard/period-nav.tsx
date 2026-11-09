import { Link } from '@tanstack/react-router';

import { buttonVariants } from '@/components/ui/button';
import { periodKinds, periodLabels, type PeriodKind } from '@/dashboard/types';

export function PeriodNav({ current }: { current: PeriodKind }) {
  return (
    <nav aria-label="Período">
      <ul className="flex flex-wrap gap-2">
        {periodKinds.map((kind) => (
          <li key={kind}>
            <Link
              to="/"
              search={{ periodo: kind }}
              aria-current={kind === current ? 'page' : undefined}
              className={buttonVariants({ variant: kind === current ? 'default' : 'outline', size: 'sm' })}
            >
              {periodLabels[kind]}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
