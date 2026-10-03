import { splitSections } from './sections.ts'

import type { TenantCompileResult } from './tenant.ts'
import type { SectionRange, TntConcept } from '../store/format.ts'

function sectionMap(body: string): Record<string, SectionRange> {
  const map: Record<string, SectionRange> = {}

  for (const section of splitSections(body)) {
    map[section.name] = { start: section.start, end: section.end }
  }

  return map
}

export function toTntConcepts(compiled: TenantCompileResult): TntConcept[] {
  return compiled.concepts.map(concept => {
    const content = compiled.bodies.get(concept.id) ?? ''
    const tnt: TntConcept = {
      id: concept.id,
      content,
      sections: sectionMap(content)
    }

    if (concept.title !== '') {
      tnt.title = concept.title
    }

    if (concept.staleAfter !== '') {
      tnt.staleAfter = concept.staleAfter
    }

    return tnt
  })
}
