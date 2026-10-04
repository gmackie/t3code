/** Recorded-shape Pistache responses shared by the routing tests. */
export const metricsFixture = {
  mode: "live",
  since: 1788700000,
  until: null,
  rows: [
    { hour: 1788706800, series: "decisions.source", label: "jev", value: 12 },
    { hour: 1788706800, series: "decisions.tier", label: "3", value: 10 },
    { hour: 1788706800, series: "decisions.model", label: "astra", value: 10 },
    { hour: 1788706800, series: "decisions.kind", label: "extraction", value: 4 },
    { hour: 1788706800, series: "tokens.input", label: "astra", value: 50000 },
    { hour: 1788706800, series: "tokens.cached", label: "astra", value: 40000 },
    { hour: 1788706800, series: "shadow.agreement", label: "true", value: 9 },
  ],
};

export const snapshotFixture = {
  mode: "live",
  decisions: [
    {
      request_id: "req-1",
      thread_id: "thread-a",
      mode: "live",
      at: 1788706810.5,
      model: "sol",
      label: "Sol",
      tier: 2,
      provider: "openai",
      signals: { task_type: "extraction", confidence: 0.92, source: "jev", turn: "continuation" },
      reasons: ["jev extraction 0.92", "affinity kept"],
      downgraded: true,
      advice: "compact",
    },
    {
      request_id: "req-2",
      thread_id: "thread-b",
      at: 1788706900,
      model: "astra",
      tier: 3,
      signals: { task_type: "planning", confidence: 0.6, source: "fallback" },
      reasons: [],
    },
    { request_id: "broken", tier: "three" },
  ],
  subscription_windows: [
    {
      id: "openai|a@example.com|weekly",
      provider: "openai",
      account: "a@example.com",
      label: "weekly",
      model_patterns: [],
      remaining_fraction: 0.42,
      observed_at: 1788706000,
      resets_at: 1789000000,
    },
  ],
  events: [
    { seq: 1, kind: "route", at: 1788706810, title: "Routed to Sol", mode: "live" },
    {
      seq: 2,
      kind: "alert",
      at: 1788706820,
      title: "weekly (a@example.com): 42% left",
      mode: "live",
    },
  ],
  usage: [{ id: "jev_calls", used: 150, threshold: 1000, label: "jev classifier calls" }],
  threads: [],
  outcomes: [],
};
