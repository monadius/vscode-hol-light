import { useVSCode } from './use_vscode';
import * as React from 'react';
import "@vscode-elements/elements/dist/vscode-button";
import "@vscode-elements/elements/dist/vscode-divider";
import "@vscode-elements/elements/dist/vscode-option";
import "@vscode-elements/elements/dist/vscode-scrollable";
import "@vscode-elements/elements/dist/vscode-single-select";
import "@vscode-elements/elements/dist/vscode-tab-header";
import "@vscode-elements/elements/dist/vscode-tab-panel";
import "@vscode-elements/elements/dist/vscode-tabs";
import type * as types from '../../src/types';
import './App.css';

if (import.meta.env.DEV) {
  await import("@vscode-elements/webview-playground");
}

function Goal({ goal }: { goal: types.Goal }) {
  return (
    <vscode-scrollable>
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 mb-2 mt-2">
        {goal.hypotheses.map((hyp, i) => (
          <React.Fragment key={i}>
            <pre className="justify-self-end">{`${i}${hyp.label ? ` (${hyp.label})` : ''}`}:</pre>
            <pre className="overflow-x-auto">
              {hyp.term}
            </pre>
          </React.Fragment>
        ))}
      </div>
      <vscode-divider/>
      <pre className="overflow-x-auto mt-2">
        {goal.term}
      </pre>
    </vscode-scrollable>
  );
}

function Goals({ goalstate }: { goalstate?: types.Goalstate }) {
  if (!goalstate || !goalstate.goals.length) {
    return <div>No goals</div>;
  }
  return (
    <vscode-tabs>
      {goalstate.goals.map((goal, i) => (
          <React.Fragment key={i}>
            <vscode-tab-header slot="header">{`Goal ${i + 1}`}</vscode-tab-header>
            <vscode-tab-panel>
              <Goal goal={goal}/>
            </vscode-tab-panel>
          </React.Fragment>
      ))}
    </vscode-tabs>
  );
}

interface ControlProps {
  printTypes: number,
  onChangePrintTypes: (printTypes: number) => void,
};

function Controls(props: ControlProps) {
  const vscode = useVSCode();
  const { printTypes, onChangePrintTypes } = props;
  return (
    <div className="flex flex-row mb-2 mt-2 gap-x-2">
      <vscode-button
        onClick={() => vscode.postMessage({ command: 'refresh' })}
      >
        Refresh
      </vscode-button>
      <vscode-single-select
        position='above'
        onchange={(e) => onChangePrintTypes(e.target.selectedIndex)}
      >
        <vscode-option selected={printTypes === 0}>Do not show types</vscode-option>
        <vscode-option selected={printTypes === 1}>Show invented types</vscode-option>
        <vscode-option selected={printTypes === 2}>Show all types</vscode-option>
      </vscode-single-select>
    </div>
  );
}

export default function App() {
  const vscode = useVSCode();
  const [printTypes, setPrintTypes] = React.useState<number>(1);
  const [goalstate, setGoalstate] = React.useState<types.Goalstate>();

  React.useEffect(() => {
    vscode.postMessage({ command: 'refresh' });
  }, [vscode]);

  React.useEffect(() => {
    const handler = (msg: MessageEvent<{ command: string }>) => {
      switch (msg.data.command) {
        case 'update': {
          const data = (msg.data as unknown) as { goalstate: types.Goalstate, printTypes: number };
          setGoalstate(data.goalstate);
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
      <div className="flex flex-col h-screen">
        {/* <div className="flex-1 overflow-auto"> */}
        <div className="flex-1">
          <Goals goalstate={goalstate}/>
        </div>
        <Controls
          printTypes={printTypes}
          onChangePrintTypes={(n: number) => {
            setPrintTypes(n);
            vscode.postMessage({ command: 'print-types', value: n });
          }}
        />
      </div>
    </>
  );
}
