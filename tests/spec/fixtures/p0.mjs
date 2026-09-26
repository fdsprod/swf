export function evidence(id = 'check-a') {
  return { id: `evidence:${id}`, kind: 'test_result', uri: `memory:${id}` };
}

export function fixture() {
  return {
    schemaVersion: 1,
    request: {
      id: 'request-1', source: { provider: 'fixture', externalId: '1' },
      repository: { url: 'fixture://offline-repository', baseRef: 'main' },
      objective: 'Implement the fixture behavior', constraints: [], acceptanceCriteria: [], metadata: {},
    },
    verification: {
      required: [{ kind: 'command', id: 'check-a', command: 'fixture-a' }, { kind: 'command', id: 'check-b', command: 'fixture-b' }],
      completionPolicy: { requireAll: true },
    },
    script: {
      agentOutcome: { kind: 'completed', summary: 'Everything is complete and tested', evidence: [] },
      verificationResults: ['check-a', 'check-b'].map(specId => ({ specId, status: 'passed', evidence: [evidence(specId)], summary: 'Required check passed' })),
    },
  };
}

export function unit() {
  const input = fixture();
  return { id: `${input.request.id}:unit:1`, objective: input.request.objective, constraints: input.request.constraints, metadata: input.request.metadata, verification: input.verification };
}

export function decision() {
  return { id: 'decision-1', runId: 'fixture-run', unitId: unit().id, question: 'Which behavior is authorized?', reason: 'Product choice', impact: [], reversible: true, evidence: [] };
}

export const states = ['PENDING', 'READY', 'RUNNING', 'WAITING_FOR_DECISION', 'VERIFYING', 'VERIFIED', 'REPAIR_READY', 'FAILED'];
export function state(status) {
  const value = { status, unit: unit() };
  if (status === 'WAITING_FOR_DECISION') value.decision = decision();
  if (status === 'VERIFIED' || status === 'REPAIR_READY') value.results = fixture().script.verificationResults;
  if (status === 'FAILED') value.reason = 'Prior failure';
  return value;
}
