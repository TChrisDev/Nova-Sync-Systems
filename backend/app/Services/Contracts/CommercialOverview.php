<?php

declare(strict_types=1);

namespace App\Services\Contracts;

use App\Enums\BillingModel;
use App\Enums\ContractStatus;
use App\Enums\ServiceLine;
use App\Enums\TimeEntryStatus;
use App\Models\Client;
use App\Models\Contract;
use App\Support\BusinessCalendar;
use Illuminate\Support\Facades\DB;

/**
 * Indicadores de Clientes y contratos para los gráficos del módulo.
 *
 * Todo sale de los contratos y de las horas registradas: nada se inventa ni
 * se guarda. No incluye costos internos ni márgenes (esos siguen exigiendo
 * projects.financials en el detalle de cada contrato).
 */
class CommercialOverview
{
    /** Contratos que todavía comprometen al cliente. */
    private const OPEN = [ContractStatus::Active, ContractStatus::Suspended];

    public function __construct(private readonly ContractInsights $insights) {}

    /** @return array<string, mixed> */
    public function build(int $months = 6): array
    {
        $today = BusinessCalendar::today();
        $open = Contract::query()
            ->with('client:id,code,name')
            ->whereIn('status', array_map(fn (ContractStatus $s) => $s->value, self::OPEN))
            ->get();
        $insights = $this->insights->for($open);

        $monthly = 0;
        $bagBalance = 0;
        $bags = [];
        $alerts = [];

        foreach ($open as $contract) {
            $info = $insights[$contract->getKey()];
            $consumption = $info['consumption'];

            if ($contract->status === ContractStatus::Active && $consumption['type'] === 'monthly_recurring') {
                $monthly += (int) $consumption['fee_amount'];
            }

            if ($consumption['type'] === 'hour_bag') {
                $bagBalance += $contract->status === ContractStatus::Active ? $consumption['balance_minutes'] : 0;
                $bags[] = [
                    'id' => $contract->id,
                    'code' => $contract->code,
                    'name' => $contract->name,
                    'client' => $contract->client?->name,
                    'purchased_minutes' => $consumption['purchased_minutes'],
                    'approved_minutes' => $consumption['approved_minutes'],
                    'pending_minutes' => $consumption['pending_minutes'],
                    'consumed_ratio' => $consumption['consumed_ratio'],
                ];
            }

            foreach ($info['alerts'] as $alert) {
                $alerts[$alert['code']] ??= ['code' => $alert['code'], 'level' => $alert['level'], 'count' => 0];
                $alerts[$alert['code']]['count']++;
            }
        }

        // Las bolsas más consumidas primero: son las que piden una recarga.
        usort($bags, fn (array $a, array $b) => ($b['consumed_ratio'] ?? -1) <=> ($a['consumed_ratio'] ?? -1));

        $byStatus = Contract::query()->groupBy('status')->selectRaw('status, COUNT(*) AS total')->pluck('total', 'status');
        $byLine = [];
        foreach ($open as $contract) {
            $key = $contract->service_line->value;
            $byLine[$key] ??= ['contracts' => 0, 'monthly_amount' => 0];
            $byLine[$key]['contracts']++;
            $consumption = $insights[$contract->getKey()]['consumption'];
            if ($contract->status === ContractStatus::Active && $consumption['type'] === 'monthly_recurring') {
                $byLine[$key]['monthly_amount'] += (int) $consumption['fee_amount'];
            }
        }

        $expiring = $open
            ->filter(fn (Contract $c) => $c->status === ContractStatus::Active && $c->end_date)
            ->map(fn (Contract $c) => [
                'id' => $c->id,
                'code' => $c->code,
                'name' => $c->name,
                'client' => $c->client?->name,
                'end_date' => $c->end_date->toDateString(),
                'days_left' => (int) $today->diffInDays(BusinessCalendar::parseDate($c->end_date->toDateString()), false),
            ])
            ->filter(fn (array $c) => $c['days_left'] <= 90)
            ->sortBy('days_left')
            ->values();

        return [
            'totals' => [
                'clients' => Client::query()->count(),
                'clients_with_open_contracts' => $open->pluck('client_id')->unique()->count(),
                'open_contracts' => $open->count(),
                'active_contracts' => $open->where('status', ContractStatus::Active)->count(),
                'monthly_recurring_amount' => $monthly,
                'bag_balance_minutes' => $bagBalance,
                'alerts' => array_sum(array_column($alerts, 'count')),
            ],
            'by_status' => array_map(fn (ContractStatus $s) => [
                'value' => $s->value,
                'label' => $s->label(),
                'count' => (int) ($byStatus[$s->value] ?? 0),
            ], ContractStatus::cases()),
            'by_service_line' => array_values(array_filter(array_map(fn (ServiceLine $l) => [
                'value' => $l->value,
                'label' => $l->label(),
                'contracts' => $byLine[$l->value]['contracts'] ?? 0,
                'monthly_amount' => $byLine[$l->value]['monthly_amount'] ?? 0,
            ], ServiceLine::cases()), fn (array $l) => $l['contracts'] > 0)),
            'bags' => array_slice($bags, 0, 8),
            'bag_count' => count($bags),
            'monthly_hours' => $this->monthlyHours($months),
            'expiring' => $expiring->all(),
            'alerts' => array_values($alerts),
        ];
    }

    /**
     * Horas aprobadas por mes y modalidad de cobro. Una sola consulta agrupada;
     * el mes se arma en PHP para que funcione igual en SQLite y PostgreSQL.
     *
     * @return list<array{month: string, hour_bag: int, monthly_recurring: int}>
     */
    private function monthlyHours(int $months): array
    {
        $today = BusinessCalendar::today();
        $first = $today->startOfMonth()->subMonths($months - 1);
        $buckets = [];
        for ($i = 0; $i < $months; $i++) {
            $buckets[$first->addMonths($i)->format('Y-m')] = ['hour_bag' => 0, 'monthly_recurring' => 0];
        }

        DB::table('time_entries')
            ->join('projects', 'projects.id', '=', 'time_entries.project_id')
            ->join('contracts', 'contracts.id', '=', 'projects.contract_id')
            ->where('time_entries.status', TimeEntryStatus::Approved->value)
            ->whereBetween('time_entries.work_date', [$first->toDateString(), $today->endOfMonth()->toDateString()])
            ->groupBy('time_entries.work_date', 'contracts.billing_model')
            ->selectRaw('time_entries.work_date AS day, contracts.billing_model AS model, SUM(time_entries.minutes) AS minutes')
            ->get()
            ->each(function ($row) use (&$buckets) {
                $month = substr((string) $row->day, 0, 7);
                $model = $row->model === BillingModel::HourBag->value ? 'hour_bag' : 'monthly_recurring';
                if (isset($buckets[$month])) {
                    $buckets[$month][$model] += (int) $row->minutes;
                }
            });

        return array_map(fn (string $month, array $v) => ['month' => $month] + $v, array_keys($buckets), $buckets);
    }
}
