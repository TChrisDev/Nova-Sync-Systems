<?php

declare(strict_types=1);

namespace App\Support\Xlsx;

use RuntimeException;
use SimpleXMLElement;
use ZipArchive;

/**
 * Lector mínimo de archivos .xlsx (Excel 2007+), sin dependencias externas.
 *
 * Un .xlsx es un ZIP con XML adentro: el libro lista las hojas, cada hoja
 * tiene sus celdas y los textos repetidos viven en sharedStrings.xml. Solo se
 * leen valores (no fórmulas ni estilos), que es lo que necesita una carga de
 * datos.
 *
 * Seguridad: el archivo viene del usuario, así que se limita el tamaño
 * descomprimido de cada parte (contra "bombas ZIP"), se leen solo las rutas
 * que el propio libro declara y el XML se interpreta sin acceso a la red.
 */
final class XlsxReader
{
    private const MAX_PART_BYTES = 60 * 1024 * 1024;

    private const MAX_ROWS = 50000;

    private ZipArchive $zip;

    /** @var list<string> */
    private array $strings = [];

    /** @var array<string, string> nombre de la hoja => ruta dentro del ZIP */
    private array $sheets = [];

    public function __construct(string $path)
    {
        if (! class_exists(ZipArchive::class)) {
            throw new RuntimeException('PHP necesita la extensión zip para leer archivos de Excel.');
        }

        $this->zip = new ZipArchive;
        if ($this->zip->open($path, ZipArchive::RDONLY) !== true) {
            throw new RuntimeException('El archivo no es un Excel válido (.xlsx).');
        }

        $this->loadSheets();
        $this->loadSharedStrings();
    }

    public function __destruct()
    {
        $this->zip->close();
    }

    /** @return list<string> */
    public function sheetNames(): array
    {
        return array_keys($this->sheets);
    }

    public function hasSheet(string $name): bool
    {
        return $this->findSheet($name) !== null;
    }

    /**
     * Filas de una hoja como listas de valores (columna A = posición 0).
     * Las filas totalmente vacías se omiten.
     *
     * @return list<list<string|null>>
     */
    public function rows(string $sheet): array
    {
        $key = $this->findSheet($sheet) ?? throw new RuntimeException("El archivo no tiene la hoja «{$sheet}».");
        $xml = $this->xml($this->sheets[$key]);
        $rows = [];

        foreach ($xml->sheetData->row ?? [] as $row) {
            $values = [];
            foreach ($row->c as $cell) {
                $index = self::columnIndex((string) $cell['r']);
                $values[$index] = $this->cellValue($cell);
            }

            if (array_filter($values, fn ($v) => $v !== null && $v !== '') === []) {
                continue;
            }

            $max = max(array_keys($values));
            $rows[] = array_map(fn ($i) => $values[$i] ?? null, range(0, $max));

            if (count($rows) > self::MAX_ROWS) {
                throw new RuntimeException('La hoja «'.$key.'» supera '.number_format(self::MAX_ROWS, 0, ',', '.').' filas.');
            }
        }

        return $rows;
    }

    /** "C12" → 2 */
    public static function columnIndex(string $reference): int
    {
        $letters = strtoupper((string) preg_replace('/\d+/', '', $reference));
        $index = 0;
        foreach (str_split($letters) as $letter) {
            $index = $index * 26 + (ord($letter) - 64);
        }

        return max(0, $index - 1);
    }

    private function cellValue(SimpleXMLElement $cell): ?string
    {
        $type = (string) $cell['t'];

        $value = match ($type) {
            's' => $this->strings[(int) $cell->v] ?? null,
            'inlineStr' => $this->text($cell->is),
            'b' => ((string) $cell->v) === '1' ? 'true' : 'false',
            default => isset($cell->v) ? (string) $cell->v : null,
        };

        if ($value === null) {
            return null;
        }

        $value = trim(str_replace(["\r\n", "\r"], "\n", $value));

        return $value === '' ? null : $value;
    }

    /** Texto de un nodo con formato enriquecido (<r><t>…</t></r>) o simple (<t>). */
    private function text(?SimpleXMLElement $node): string
    {
        if ($node === null) {
            return '';
        }
        if (isset($node->t)) {
            return (string) $node->t;
        }

        $text = '';
        foreach ($node->r as $run) {
            $text .= (string) $run->t;
        }

        return $text;
    }

    private function findSheet(string $name): ?string
    {
        $wanted = mb_strtolower(trim($name));
        foreach (array_keys($this->sheets) as $sheet) {
            if (mb_strtolower(trim($sheet)) === $wanted) {
                return $sheet;
            }
        }

        return null;
    }

    private function loadSheets(): void
    {
        $workbook = $this->xml('xl/workbook.xml');
        $relations = $this->xml('xl/_rels/workbook.xml.rels');

        $targets = [];
        foreach ($relations->Relationship as $relation) {
            $target = ltrim((string) $relation['Target'], '/');
            $targets[(string) $relation['Id']] = str_starts_with($target, 'xl/') ? $target : 'xl/'.$target;
        }

        foreach ($workbook->sheets->sheet as $sheet) {
            $id = (string) $sheet->attributes('http://schemas.openxmlformats.org/officeDocument/2006/relationships')['id'];
            $target = $targets[$id] ?? null;
            // Solo rutas de hojas dentro del libro: nada de "../" ni rutas raras.
            if ($target && preg_match('#^xl/worksheets/[\w.-]+\.xml$#', $target)) {
                $this->sheets[(string) $sheet['name']] = $target;
            }
        }
    }

    private function loadSharedStrings(): void
    {
        if ($this->zip->locateName('xl/sharedStrings.xml') === false) {
            return;
        }

        foreach ($this->xml('xl/sharedStrings.xml')->si as $item) {
            $this->strings[] = $this->text($item);
        }
    }

    private function xml(string $part): SimpleXMLElement
    {
        $stat = $this->zip->statName($part);
        if ($stat === false) {
            throw new RuntimeException('El archivo no es un Excel válido (.xlsx).');
        }
        if ($stat['size'] > self::MAX_PART_BYTES) {
            throw new RuntimeException('El archivo de Excel es demasiado grande para importarlo.');
        }

        $content = $this->zip->getFromName($part);
        $xml = $content === false ? false : simplexml_load_string($content, SimpleXMLElement::class, LIBXML_NONET | LIBXML_COMPACT);
        if ($xml === false) {
            throw new RuntimeException('El archivo de Excel está dañado.');
        }

        return $xml;
    }
}
