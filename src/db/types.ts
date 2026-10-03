import type { Diagnostic, SyncResult } from '../types.ts'
import type { SnapshotChecksums } from '../store/integrity.ts'
import type { WriteMetadata } from './writecache.ts'
import type { ImportArtifact, ImportReference } from './importstate.ts'

export interface DatabaseTarget {
  root: string
  tenant: string
}

export interface DocumentRecord {
  bundle: string
  path: string
  source: string
}

export interface Head {
  version: 1
  revision: string
  snapshot: string
  archive: string
  checksums: SnapshotChecksums
  retained?: string[]
  imports?: ImportReference[]
}

export interface Revision extends SyncResult {
  version: 1
  parent: string | null
  archive: string
  created: string
  summaryWidth: number
  checksums: SnapshotChecksums
}

export interface SourceRecord {
  bundle: string
  path: string
  id?: string
  body?: { offset: number; length: number; checksum: number }
  hash: string
  bytes: number
  offset: number
  length: number
  checksum: number
}

export interface SourceArchive {
  entries: SourceRecord[]
  payload: Uint8Array
  bundles: { name: string; diagnostics: Diagnostic[] }[]
}

export interface Prepared {
  imports?: ImportArtifact[]
  metadata?: WriteMetadata
  checksums: SnapshotChecksums
  snapshot: string
  snapshotBytes: Uint8Array
  archive: string
  archiveBytes: Uint8Array
  concepts: number
  bundles: string[]
  diagnostics: Diagnostic[]
  summaryWidth: number
}
