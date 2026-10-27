export class SyncInProgressError extends Error {
  constructor() {
    super('Sync already in progress')
    this.name = 'SyncInProgressError'
  }
}
