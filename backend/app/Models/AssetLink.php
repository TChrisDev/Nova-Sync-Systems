<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** Un cable o conexión entre dos equipos del mismo cliente. */
class AssetLink extends Model
{
    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['is_functional' => 'boolean'];
    }

    public function source(): BelongsTo
    {
        return $this->belongsTo(Asset::class, 'source_asset_id');
    }

    public function target(): BelongsTo
    {
        return $this->belongsTo(Asset::class, 'target_asset_id');
    }
}
