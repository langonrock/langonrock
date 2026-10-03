const EMPTY_CELL = '-'

export interface ManifestRow {
  id: string
  bundle: string
  cells: string[]
  links: string[]
}

export interface Manifest {
  comments: string[]
  columns: string
  rows: Map<string, ManifestRow>
}

export function parseManifest(tsv: string): Manifest {
  const comments: string[] = []
  const rows = new Map<string, ManifestRow>()
  let columns = ''
  let bundleColumn = -1

  for (const line of tsv.split('\n')) {
    if (line === '') {
      continue
    }

    if (columns === '') {
      if (line.startsWith('id\t')) {
        columns = line
        bundleColumn = line.split('\t').indexOf('bundle')
      } else {
        comments.push(line)
      }

      continue
    }

    const cells = line.split('\t')
    const links = cells[cells.length - 1] ?? EMPTY_CELL

    rows.set(cells[0] ?? '', {
      id: cells[0] ?? '',
      bundle: cells[bundleColumn] ?? '',
      cells,
      links: links === EMPTY_CELL ? [] : links.split(' ')
    })
  }

  return { comments, columns, rows }
}
