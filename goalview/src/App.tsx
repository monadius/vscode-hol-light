/* eslint-disable @typescript-eslint/no-unused-vars */
import { useVSCode } from './use_vscode';
import * as React from 'react';
import "@vscode-elements/elements/dist/vscode-button";
import "@vscode-elements/elements/dist/vscode-divider";
import "@vscode-elements/elements/dist/vscode-tabs";
import "@vscode-elements/elements/dist/vscode-tab-header";
import "@vscode-elements/elements/dist/vscode-tab-panel";
import "@vscode-elements/elements/dist/vscode-option";
import "@vscode-elements/elements/dist/vscode-single-select";
import type { Goal } from './types';
import './App.css';

if (import.meta.env.DEV) {
  await import("@vscode-elements/webview-playground");
}

function Goal({ goal }: { goal: Goal }) {
  return (
    <>
      <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 mb-2 mt-2">
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
          <React.Fragment key={i}>
            <vscode-tab-header slot="header">{`Goal ${i + 1}`}</vscode-tab-header>
            <vscode-tab-panel>
              <Goal goal={goal}/>
            </vscode-tab-panel>
          </React.Fragment>
        ))
      }
    </vscode-tabs>
  );
}

export default function App() {
  const vscode = useVSCode();
  const [printTypes, setPrintTypes] = React.useState<number>(1);
  const [goals, setGoals] = React.useState<Goal[]>();

  React.useEffect(() => {
    vscode.postMessage({ command: 'refresh' });
  }, [vscode]);

  React.useEffect(() => {
    const handler = (msg: MessageEvent<{ command: string }>) => {
      switch (msg.data.command) {
        case 'update': {
          const data = (msg.data as unknown) as { text: string, goals: Goal[], printTypes: number };
          setGoals(data.goals);
          setPrintTypes(Math.max(0, Math.min(data.printTypes, 2)));
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
        <vscode-single-select
          onchange={(e) => {
            setPrintTypes(e.target.selectedIndex);
            vscode.postMessage({ command: 'print-types', value: e.target.selectedIndex })
          }}
        >
          <vscode-option selected={printTypes === 0}>Do not show types</vscode-option>
          <vscode-option selected={printTypes === 1}>Show invented types</vscode-option>
          <vscode-option selected={printTypes === 2}>Show all types</vscode-option>
        </vscode-single-select>
      </div>
    </>
  );
}
