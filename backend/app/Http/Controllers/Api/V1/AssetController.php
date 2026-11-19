<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1;

use App\Enums\AssetCategory;
use App\Enums\Criticality;
use App\Http\Controllers\Controller;
use App\Http\Requests\Assets\AssetRequest;
use App\Http\Requests\Assets\ImportAssetsRequest;
use App\Http\Resources\AssetResource;
use App\Models\Asset;
use App\Models\AssetLink;
use App\Models\Client;
use App\Services\Assets\AssetImporter;
use App\Services\Assets\AssetInsights;
use App\Services\Assets\AssetService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Validation\Rule;
use RuntimeException;

/**
 * Inventario de equipos por cliente, panel técnico, mapa de red, cobertura
 * de monitoreo e importación desde Excel. Todas las rutas exigen
 * assets.view; cada escritura revisa su permiso propio.
 */
class AssetController extends Controller
{
    public function __construct(
        private readonly AssetService $assets,
        private readonly AssetInsights $insights,
    ) {}

    /** Clientes con equipos (y, para quien importa o registra, todos los clientes). */
    public function clients(Request $request): JsonResponse
    {
        $user = $request->user();
        $withAssets = Client::query()->whereHas('assets')->withCount('assets')->orderBy('name')->get(['id', 'code', 'name']);

        return response()->json(['data' => [
            'with_assets' => $withAssets->map(fn (Client $c) => ['id' => $c->id, 'code' => $c->code, 'name' => $c->name, 'assets' => $c->assets_count])->values(),
            'all' => $user->hasPermission('assets.import') || $user->hasPermission('assets.create')
                ? Client::query()->orderBy('name')->get(['id', 'code', 'name'])->map(fn (Client $c) => ['id' => $c->id, 'code' => $c->code, 'name' => $c->name])->values()
                : [],
            'categories' => AssetCategory::options(),
            'criticalities' => Criticality::options(),
            'reading_types' => collect(config('nova.assets.reading_types'))->map(fn (array $t, string $k) => ['value' => $k, ...$t])->values(),
            'controls' => collect(config('nova.assets.monitoring_controls'))->map(fn (array $c, string $k) => ['value' => $k, ...$c])->values(),
        ]]);
    }

    public function index(Request $request): AnonymousResourceCollection
    {
        $filters = $request->validate([
            'client_id' => ['required', 'integer', 'exists:clients,id'],
            'search' => ['sometimes', 'nullable', 'string', 'max:100'],
            'category' => ['sometimes', 'nullable', Rule::enum(AssetCategory::class)],
            'group' => ['sometimes', 'nullable', Rule::in(array_keys(AssetCategory::groupLabels()))],
            'criticality' => ['sometimes', 'nullable', Rule::enum(Criticality::class)],
            'location' => ['sometimes', 'nullable', 'string', 'max:120'],
            'unmonitored' => ['sometimes', 'boolean'],
            'per_page' => ['sometimes', 'integer', 'min:5', 'max:100'],
            'page' => ['sometimes', 'integer', 'min:1'],
        ]);

        $technical = $request->user()->hasPermission('assets.technical');
        $search = trim((string) ($filters['search'] ?? ''));
        $groupCategories = isset($filters['group'])
            ? array_map(fn (AssetCategory $c) => $c->value, array_filter(AssetCategory::cases(), fn (AssetCategory $c) => $c->group() === $filters['group']))
            : null;

        $query = Asset::query()
            ->where('client_id', $filters['client_id'])
            ->when($search !== '', function ($q) use ($search, $technical) {
                $like = '%'.str_replace(['%', '_'], ['\%', '\_'], mb_strtolower($search)).'%';
                $q->where(function ($w) use ($like, $technical) {
                    $w->whereRaw('LOWER(name) LIKE ?', [$like])
                        ->orWhereRaw('LOWER(COALESCE(model, \'\')) LIKE ?', [$like])
                        ->orWhereRaw('LOWER(COALESCE(role, \'\')) LIKE ?', [$like])
                        ->orWhereRaw('LOWER(COALESCE(location, \'\')) LIKE ?', [$like]);
                    // Buscar por IP, MAC o serial solo si la persona puede verlos.
                    if ($technical) {
                        $w->orWhereRaw('LOWER(COALESCE(serial, \'\')) LIKE ?', [$like])
                            ->orWhereRaw('LOWER(COALESCE(CAST(ip_addresses AS TEXT), \'\')) LIKE ?', [$like])
                            ->orWhereRaw('LOWER(COALESCE(CAST(mac_addresses AS TEXT), \'\')) LIKE ?', [$like]);
                    }
                });
            })
            ->when($filters['category'] ?? null, fn ($q, $c) => $q->where('category', $c))
            ->when($groupCategories, fn ($q, $list) => $q->whereIn('category', $list))
            ->when($filters['criticality'] ?? null, fn ($q, $c) => $q->where('criticality', $c))
            ->when($filters['location'] ?? null, fn ($q, $l) => $q->where('location', $l))
            ->orderByRaw("CASE criticality WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END")
            ->orderBy('name');

        if ($request->boolean('unmonitored')) {
            $network = array_map(fn (AssetCategory $c) => $c->value, array_filter(AssetCategory::cases(), fn (AssetCategory $c) => $c->isNetwork()));
            $ids = (clone $query)->whereIn('category', $network)->get(['id', 'monitoring', 'category'])->filter(fn (Asset $a) => $a->monitoringCount() < count(Asset::MONITORING_CONTROLS))->pluck('id');
            $query->whereKey($ids);
        }

        return AssetResource::collection($query->paginate($filters['per_page'] ?? 20)->withQueryString());
    }

    public function show(Request $request, Asset $asset): JsonResponse
    {
        $links = AssetLink::query()
            ->with(['source:id,name,category', 'target:id,name,category'])
            ->where('source_asset_id', $asset->id)
            ->orWhere('target_asset_id', $asset->id)
            ->get()
            ->map(function (AssetLink $link) use ($asset) {
                $outgoing = $link->source_asset_id === $asset->id;
                $other = $outgoing ? $link->target : $link->source;

                return [
                    'id' => $link->id,
                    'asset' => ['id' => $other->id, 'name' => $other->name, 'category' => $other->category->label()],
                    'local_port' => $outgoing ? $link->source_port : $link->target_port,
                    'remote_port' => $outgoing ? $link->target_port : $link->source_port,
                    'functional' => $link->is_functional,
                ];
            });

        return response()->json(['data' => [
            ...(new AssetResource($asset->load('client')))->resolve($request),
            'links' => $links,
            'readings' => $asset->readings()->count(),
            'alerts' => $asset->alerts()->count(),
        ]]);
    }

    public function store(AssetRequest $request): JsonResponse
    {
        $asset = $this->assets->create($request->user(), $request->validated());

        return (new AssetResource($asset))->additional(['message' => 'Equipo registrado.'])->response()->setStatusCode(201);
    }

    public function update(AssetRequest $request, Asset $asset): AssetResource
    {
        return (new AssetResource($this->assets->update($request->user(), $asset, $request->validated())))->additional(['message' => 'Equipo actualizado.']);
    }

    public function destroy(Request $request, Asset $asset): JsonResponse
    {
        abort_unless($request->user()->hasPermission('assets.delete'), 403, 'No tienes permiso para eliminar equipos.');
        $this->assets->delete($request->user(), $asset);

        return response()->json(['message' => 'Equipo eliminado con sus enlaces y lecturas.']);
    }

    public function dashboard(Request $request): JsonResponse
    {
        return response()->json(['data' => $this->insights->dashboard($this->client($request))]);
    }

    public function map(Request $request): JsonResponse
    {
        return response()->json(['data' => $this->insights->map($this->client($request), $request->user()->hasPermission('assets.technical'))]);
    }

    public function coverage(Request $request): JsonResponse
    {
        return response()->json(['data' => $this->insights->coverage($this->client($request))]);
    }

    /**
     * Carga desde Excel. Con dry_run=1 (la opción por defecto) devuelve el
     * resumen sin guardar nada; con dry_run=0 lo aplica.
     */
    public function import(ImportAssetsRequest $request, AssetImporter $importer): JsonResponse
    {
        $client = Client::query()->findOrFail($request->validated('client_id'));
        $files = $request->file('files');
        $dryRun = $request->boolean('dry_run', true);

        try {
            $summary = $importer->run(
                $client,
                array_map(fn ($f) => $f->getRealPath(), $files),
                $dryRun,
                $request->user(),
                array_map(fn ($f) => $f->getClientOriginalName(), $files),
            );
        } catch (RuntimeException $e) {
            return response()->json(['message' => $e->getMessage(), 'code' => 'import_failed'], 422);
        }

        return response()->json([
            'data' => $summary,
            'message' => $dryRun ? 'Revisa el resumen y confirma la importación.' : 'Importación completada.',
        ]);
    }

    private function client(Request $request): Client
    {
        $id = $request->validate(['client_id' => ['required', 'integer', 'exists:clients,id']])['client_id'];

        return Client::query()->findOrFail($id);
    }
}
