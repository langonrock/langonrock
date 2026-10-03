import { EVALUATION_DATE } from './protocol.ts'

export function fixEvaluationDate(): void {
  const OriginalDate = Date
  const timestamp = OriginalDate.parse(EVALUATION_DATE)

  globalThis.Date = new Proxy(OriginalDate, {
    construct: (target, args, newTarget) =>
      Reflect.construct(
        target,
        args.length === 0 ? [timestamp] : args,
        newTarget
      ) as Date,
    apply: () => new OriginalDate(timestamp).toString(),
    get: (target, property, receiver) =>
      property === 'now'
        ? () => timestamp
        : (Reflect.get(target, property, receiver) as unknown)
  })
}
