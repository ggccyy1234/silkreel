export class ChoreoConfigError extends Error {
  readonly field: string
  readonly value: unknown

  constructor(field: string, value: unknown, reason: string) {
    super(`Invalid film config field "${field}" (${String(value)}): ${reason}`)
    this.name = 'ChoreoConfigError'
    this.field = field
    this.value = value
  }
}
