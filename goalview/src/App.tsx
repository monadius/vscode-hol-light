/* eslint-disable @typescript-eslint/no-unused-vars */
import { useVSCode } from './use-vscode';
import * as React from 'react';
import "@vscode-elements/elements/dist/vscode-button";
import "@vscode-elements/elements/dist/vscode-checkbox";
import "@vscode-elements/elements/dist/vscode-divider";
import "@vscode-elements/elements/dist/vscode-icon";
import "@vscode-elements/elements/dist/vscode-label";
import "@vscode-elements/elements/dist/vscode-option";
import "@vscode-elements/elements/dist/vscode-single-select";
import "@vscode-elements/elements/dist/vscode-tab-header";
import "@vscode-elements/elements/dist/vscode-tab-panel";
import "@vscode-elements/elements/dist/vscode-tabs";
import type * as types from '../../src/types';
import { ansiToReact } from './ansi';
import './App.css';

if (import.meta.env.DEV) {
  await import("@vscode-elements/webview-playground");
}

function Term({ term }: { term: string }) {
  return (
    <pre className="overflow-x-auto term">{ansiToReact(term)}</pre>
  );
}

function Goal({ goal }: { goal: types.Goal }) {
  return (
    <>
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 mb-2 mt-2">
        {goal.hypotheses.map((hyp, i) => (
          <React.Fragment key={i}>
            <pre className="justify-self-end term">{`${i}${hyp.label ? ` (${hyp.label})` : ''}`}:</pre>
            <Term term={hyp.term}/>
          </React.Fragment>
        ))}
      </div>
      <vscode-divider className={goal.hypotheses.length ? "mb-2" : "hidden"}/>
      <Term term={goal.term}/>
    </>
  );
}

function Goals({ goalstate }: { goalstate?: types.Goalstate }) {
  if (!goalstate) {
    return <div></div>;
  }
  if (!goalstate || !goalstate.goals.length) {
    return <div className='p-4'>No goals</div>;
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
  printTypes: number;
  onChangePrintTypes: (printTypes: number) => void;
  color: boolean;
  onChangeColor: (color: boolean) => void;
  maxBoxes: number;
  onChangeMaxBoxes: (maxBoxes: number) => void;
  margin: number;
  onChangeMargin: (margin: number) => void;
};

function Controls(props: ControlProps) {
  const { printTypes, onChangePrintTypes, 
    color, onChangeColor,
    maxBoxes, onChangeMaxBoxes,
    margin, onChangeMargin } = props;

  const vscode = useVSCode();
  const [showExtra, setShowExtra] = React.useState<boolean>(false);

  return (
    <div className="flex flex-col mt-2">
      <div className={"flex flex-row gap-x-2 overflow-hidden"
        // + " transition-all duration-300"
        + (showExtra ? ' max-h-screen opacity-100 mb-2' : ' max-h-0 opacity-0')}>
        {/* Margin */}
        <vscode-label><span className='normal'>Margin</span></vscode-label>
        <vscode-single-select
          value={margin.toString()}
          position='above'
          onchange={(e) => onChangeMargin(+e.currentTarget.value)}
        >
          <vscode-option>10</vscode-option>
          <vscode-option>20</vscode-option>
          <vscode-option>40</vscode-option>
          <vscode-option>80</vscode-option>
          <vscode-option>100</vscode-option>
          <vscode-option>200</vscode-option>
          <vscode-option>1000</vscode-option>
        </vscode-single-select>
        {/* Max hypothesis boxes */}
        <vscode-label><span className='normal'>Max&nbsp;hyp.&nbsp;boxes</span></vscode-label>
        <vscode-single-select
          value={maxBoxes.toString()}
          position='above'
          onchange={(e) => onChangeMaxBoxes(+e.currentTarget.value)}
        >
          <vscode-option>2</vscode-option>
          <vscode-option>3</vscode-option>
          <vscode-option>4</vscode-option>
          <vscode-option>10</vscode-option>
          <vscode-option>100</vscode-option>
        </vscode-single-select>
        {/* Max boxes */}
        <vscode-label><span className='normal'>Max&nbsp;boxes</span></vscode-label>
        <vscode-single-select
          value={maxBoxes.toString()}
          position='above'
          onchange={(e) => onChangeMaxBoxes(+e.currentTarget.value)}
        >
          <vscode-option>2</vscode-option>
          <vscode-option>5</vscode-option>
          <vscode-option>100</vscode-option>
        </vscode-single-select>
      </div>
      <div className="flex flex-row mb-2 gap-x-2">
        {/* Refresh */}
        <vscode-button
          onClick={() => vscode.postMessage({ command: 'refresh' })}
        >
          Refresh
        </vscode-button>
        {/* Show types */}
        <vscode-single-select
          value={printTypes.toString()}
          position='above'
          onchange={(e) => onChangePrintTypes(e.target.selectedIndex)}
        >
          <vscode-option value='0'>Do not show types</vscode-option>
          <vscode-option value='1'>Show invented types</vscode-option>
          <vscode-option value='2'>Show all types</vscode-option>
        </vscode-single-select>
        {/* Color */}
        <vscode-checkbox
          label="Color"
          checked={color}
          onChange={(e) => onChangeColor(e.currentTarget.checked)}
        />
        {/* Show extra options */}
        <vscode-icon name={showExtra ? 'remove' : 'add'} actionIcon
          className='ml-auto'
          onClick={() => setShowExtra(!showExtra)}
        >
          Extra
        </vscode-icon>
      </div>
    </div>
  );
}

export default function App() {
  const vscode = useVSCode();
  const [printTypes, setPrintTypes] = React.useState<number>(1);
  const [color, setColor] = React.useState<boolean>(true);
  const [maxBoxes, setMaxBoxes] = React.useState<number>(100);
  const [margin, setMargin] = React.useState<number>(80);
  const [goalstate, setGoalstate] = React.useState<types.Goalstate>();

  React.useEffect(() => {
    vscode.postMessage({ command: 'refresh', maxBoxes: maxBoxes, margin: margin, color: color });
  }, [vscode, maxBoxes, margin, color]);

  React.useEffect(() => {
    const handler = (msg: MessageEvent<{ command: string }>) => {
      switch (msg.data.command) {
        case 'update': {
          const data = (msg.data as unknown) as { goalstate: types.Goalstate, printTypes: number };
          setGoalstate(data.goalstate);
          setPrintTypes(Math.max(0, Math.min(data.printTypes | 0, 2)));
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
          color={color}
          onChangeColor={(b: boolean) => setColor(b)}
          printTypes={printTypes}
          onChangePrintTypes={(n: number) => {
            setPrintTypes(n);
            vscode.postMessage({ command: 'print-types', value: n });
          }}
          maxBoxes={maxBoxes}
          onChangeMaxBoxes={(n: number) => setMaxBoxes(n)}
          margin={margin}
          onChangeMargin={(n: number) => setMargin(n)}
        />
      </div>
    </>
  );
}
