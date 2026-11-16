<?php

namespace App\Providers;

use App\Auth\EntraId\EntraIdConfig;
use App\Auth\EntraId\EntraIdProvider;
use App\Auth\EntraId\IdTokenValidator;
use App\Auth\Google\GoogleConfig;
use App\Auth\Google\GoogleIdTokenValidator;
use App\Auth\Google\GoogleWorkspaceProvider;
use App\Models\Allocation;
use App\Models\Client;
use App\Models\Contract;
use App\Models\Project;
use App\Models\Role;
use App\Models\StaffProfile;
use App\Models\TimeEntry;
use App\Models\User;
use App\Observers\DomainEventObserver;
use App\Services\Events\DomainEventRecorder;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\Relation;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use Laravel\Socialite\Facades\Socialite;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->bind(EntraIdConfig::class, fn () => EntraIdConfig::fromConfig());
        $this->app->bind(GoogleConfig::class, fn () => GoogleConfig::fromConfig());
    }

    public function boot(): void
    {
        // Evita asignación masiva silenciosa y consultas N+1 durante el desarrollo.
        Model::shouldBeStrict(! $this->app->isProduction());

        // Nombres estables en la auditoría en lugar de nombres de clase.
        Relation::enforceMorphMap([
            'user' => User::class,
            'role' => Role::class,
            'client' => Client::class,
            'contract' => Contract::class,
            'project' => Project::class,
            'allocation' => Allocation::class,
            'staff_profile' => StaffProfile::class,
            'time_entry' => TimeEntry::class,
        ]);

        // Eventos de dominio para Kafka (se registran solo si están habilitados).
        foreach (array_keys(DomainEventRecorder::MODELS) as $model) {
            $model::observe(DomainEventObserver::class);
        }

        Socialite::extend('entra', function ($app) {
            $config = $app->make(EntraIdConfig::class);

            /** @var EntraIdProvider $provider */
            $provider = Socialite::buildProvider(EntraIdProvider::class, [
                'client_id' => (string) $config->clientId,
                'client_secret' => (string) $config->clientSecret,
                'redirect' => (string) $config->redirectUri,
            ]);

            return $provider->withEntraConfig($config, $app->make(IdTokenValidator::class));
        });

        Socialite::extend('google-workspace', function ($app) {
            $config = $app->make(GoogleConfig::class);

            /** @var GoogleWorkspaceProvider $provider */
            $provider = Socialite::buildProvider(GoogleWorkspaceProvider::class, [
                'client_id' => (string) $config->clientId,
                'client_secret' => (string) $config->clientSecret,
                'redirect' => (string) $config->redirectUri,
            ]);

            return $provider->withGoogleConfig($config, $app->make(GoogleIdTokenValidator::class));
        });

        RateLimiter::for('api', fn (Request $request) => Limit::perMinute(120)->by($request->user()?->id ?: $request->ip()));
        RateLimiter::for('auth', fn (Request $request) => Limit::perMinute(20)->by($request->ip()));
    }
}
