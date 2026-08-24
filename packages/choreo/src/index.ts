export interface TimelinePlaceholder {
  status: 'pending-implementation'
}

export function pendingTimeline(): TimelinePlaceholder {
  return { status: 'pending-implementation' }
}
