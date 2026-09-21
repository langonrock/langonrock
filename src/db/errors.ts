export class InvalidRequestError extends Error {}

export class LegacyTenantError extends Error {
  readonly code = 'LEGACY_TENANT'

  constructor() {
    super(
      'legacy tenant: migrate with original sources before using database transactions'
    )
  }
}

export class ConflictError extends Error {
  readonly code = 'CONFLICT'

  constructor(
    message = 'database changed: re-read the revision and document hashes'
  ) {
    super(message)
  }
}

export class MissingDatabaseError extends Error {
  constructor() {
    super(
      'tenant has no source directory or native database; import or migrate original sources first'
    )
  }
}

export class IndeterminateCommitError extends Error {
  readonly code = 'INDETERMINATE_COMMIT'

  constructor(
    readonly revision: string,
    cause: unknown
  ) {
    super(
      `commit outcome is indeterminate; inspect revision ${revision} before retrying`,
      { cause }
    )
  }
}

export function corruption(message: string): Error {
  return new Error(
    `database corruption: ${message}; run verify before attempting repair`
  )
}
