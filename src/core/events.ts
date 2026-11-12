export interface ComputerEvent {
  seq: number;
  ts: number;
  type: string;
  data: Record<string, unknown>;
}

export interface EventPage {
  events: ComputerEvent[];
  seq: number;
}

/** Small in-memory ring buffer with long-poll support. */
export class EventBus {
  private events: ComputerEvent[] = [];
  private nextSeq = 1;
  private waiters = new Set<() => void>();

  constructor(private readonly maxEvents = 1000) {}

  add(type: string, data: Record<string, unknown> = {}): ComputerEvent {
    const event: ComputerEvent = {
      seq: this.nextSeq++,
      ts: Date.now(),
      type,
      data,
    };
    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      this.events.splice(0, this.events.length - this.maxEvents);
    }
    this.wake();
    return event;
  }

  snapshot(since = 0): EventPage {
    const events = this.eventsAfter(since);
    return { events, seq: events.at(-1)?.seq ?? Math.max(0, since) };
  }

  async wait(since: number, seconds: number): Promise<EventPage> {
    const immediately = this.snapshot(since);
    if (immediately.events.length > 0 || seconds <= 0) return immediately;
    return new Promise<EventPage>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.waiters.delete(finish);
        resolve(this.snapshot(since));
      };
      const timer = setTimeout(finish, Math.max(0, seconds) * 1000);
      this.waiters.add(finish);
    });
  }

  private eventsAfter(since: number): ComputerEvent[] {
    if (this.events.length === 0) return [];
    const firstSeq = this.events[0].seq;
    if (since < firstSeq - 1) return [...this.events];
    return this.events.filter((event) => event.seq > since);
  }

  private wake(): void {
    for (const waiter of [...this.waiters]) waiter();
  }
}
