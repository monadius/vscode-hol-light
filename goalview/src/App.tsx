/* eslint-disable @typescript-eslint/no-unused-vars */
import { useVSCode } from './use_vscode';
import * as React from 'react';
import "@vscode-elements/elements/dist/vscode-button";
import "@vscode-elements/elements/dist/vscode-divider";
import "@vscode-elements/elements/dist/vscode-tabs";
import "@vscode-elements/elements/dist/vscode-tab-header";
import "@vscode-elements/elements/dist/vscode-tab-panel";
import type { Goal } from './types';
import './App.css';

if (import.meta.env.DEV) {
  await import("@vscode-elements/webview-playground");
}

function Goal({ goal }: { goal: Goal }) {
  return (
    <>
      <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-2 mb-2 mt-2">
        {goal.assumptions.map(([label, assumption], i) => (
          <React.Fragment key={i}>
            <code>{label}</code>
            <pre>{assumption}</pre>
          </React.Fragment>
        ))}
      </div>
      <vscode-divider/>
      <pre className="mt-2">
        {goal.conclusion}
      </pre>
    </>
  );
}

function Goals({ goals }: { goals: Goal[] }) {
  return (
    <vscode-tabs>
      {
        goals.map((goal, i) => (
          <>
            <vscode-tab-header slot="header">{`Goal ${i + 1}`}</vscode-tab-header>
            <vscode-tab-panel>
              <Goal goal={goal}/>
            </vscode-tab-panel>
          </>
        ))
      }
    </vscode-tabs>
  );
}

export default function App() {
  const vscode = useVSCode();
  const [_text, setText] = React.useState('no goal');
  const [goals, setGoals] = React.useState<Goal[]>();

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
      <div className="text-start">
        {!goals || !goals.length ? (<div>No goals</div>) : <Goals goals={goals}/>}
        <br/>
        <vscode-button
          onClick={() => vscode.postMessage({ command: 'refresh' })}
        >
          Refresh
        </vscode-button>
      </div>
    </>
  );
}
