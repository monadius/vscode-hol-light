/* eslint-disable @typescript-eslint/no-unused-vars */
import { useVSCode } from './use_vscode';
import * as React from 'react';
import "@vscode-elements/elements/dist/vscode-button";
import "@vscode-elements/elements/dist/vscode-divider";
import type { Goal } from './types';
import './App.css';

if (import.meta.env.DEV) {
  await import("@vscode-elements/webview-playground");
}

function Goal({ goal }: { goal: Goal }) {
  console.log(goal.conclusion);
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        {goal.assumptions.map(([label, assumption], i) => (
          <React.Fragment key={i}>
            <code>{label}</code>
            <code>{assumption}</code>
          </React.Fragment>
        ))}
      </div>
      <vscode-divider/>
      <pre>
        {goal.conclusion}
      </pre>
    </>
  );
}

export default function App() {
  const vscode = useVSCode();
  const [text, setText] = React.useState('no goal');
  const [goals, setGoals] = React.useState<Goal[]>();

  console.log(goals);

  React.useEffect(() => {
    vscode.postMessage({ command: 'refresh' });
  }, [vscode]);

  React.useEffect(() => {
    const handler = (msg: MessageEvent<{ command: string }>) => {
      switch (msg.data.command) {
        case 'update': {
          const data = (msg.data as unknown) as { text: string, goals: Goal[] };
          setText(data.text);
          setGoals(data.goals);
          break;
        }
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  });

  return (
    <>
      {import.meta.env.DEV ? <vscode-dev-toolbar></vscode-dev-toolbar> : null}
      <div style={{ fontFamily: 'sans-serif', padding: 20, textAlign: 'start' }}>
        <h1>
          Goals
        </h1>
        {!goals ? (<div>No goals</div>) : <Goal goal={goals[0]}/>}
        {/* <code style={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>{text}</code> */}
        {/* <vscode-divider></vscode-divider> */}
        <br/>
        <vscode-button
          onClick={() => vscode.postMessage({ command: 'refresh' })}
        >
          Refresh
        </vscode-button>
        {/* <div
          style={{
            marginTop: 20,
            padding: '10px 20px',
            background: '#007acc',
            color: 'white',
            borderRadius: 4,
            cursor: 'pointer',
            display: 'inline-block',
            fontWeight: 'bold',
            textAlign: 'center'
          }}
          onClick={() => vscode.postMessage({ command: 'refresh' })}
        >
          Refresh
        </div> */}
      </div>
    </>
  );
}
