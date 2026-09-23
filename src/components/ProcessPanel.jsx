import React from 'react';

export function ProcessPanel({ busy, phase, steps }) {
  if (!busy) return null;
  return <details className="process">
    <summary><span className="pulse"/><span role="status">{phase || '正在回答'}</span></summary>
    <ol>{steps.map((step, index) => <li key={`${step}-${index}`}>{step}</li>)}</ol>
  </details>;
}
