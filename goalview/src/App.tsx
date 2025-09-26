/* eslint-disable @typescript-eslint/no-unused-vars */
import * as React from 'react';

import "@vscode-elements/elements/dist/vscode-button";
import "@vscode-elements/elements/dist/vscode-checkbox";
import "@vscode-elements/elements/dist/vscode-divider";
import "@vscode-elements/elements/dist/vscode-label";
import "@vscode-elements/elements/dist/vscode-option";
import "@vscode-elements/elements/dist/vscode-single-select";
import "@vscode-elements/elements/dist/vscode-tab-header";
import "@vscode-elements/elements/dist/vscode-tab-panel";
import "@vscode-elements/elements/dist/vscode-tabs";
import { VscAdd, VscRemove } from "react-icons/vsc";

import { useVSCode } from './use-vscode';
import type { Goalstate, Goal, GoalviewState, GoalOptions, GoalviewMessage, MessageCommands } from '../../src/types';
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

function Goal({ goal }: { goal: Goal }) {
  return (
    <>
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 mb-2 mt-2">
        {goal.hypotheses.map((hyp, i) => (
          <React.Fragment key={i}>
            <pre className="justify-self-end term">{`${hyp.label ? `(${hyp.label}) ` : ''}${i}`}:</pre>
            <Term term={hyp.term}/>
          </React.Fragment>
        ))}
      </div>
      <vscode-divider className={goal.hypotheses.length ? "mb-2" : "hidden"}/>
      <Term term={goal.term}/>
    </>
  );
}

function Goals({ goalstate }: { goalstate?: Goalstate }) {
  const [selectedTab, setSelectedTab] = React.useState<number>(0);
  if (!goalstate) {
    return <div></div>;
  }
  if (!goalstate || !goalstate.goals.length) {
    return <div className='p-4'>No goals</div>;
  }
  // console.log('Updated: ' + selectedTab);
  return (
    <vscode-tabs 
      selectedIndex={Math.min(goalstate.goals.length - 1, selectedTab)}
      onvsc-tabs-select={(e) => setSelectedTab((e.currentTarget as { selectedIndex: number } | null)?.selectedIndex ?? 0)}
    >
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

function ExtraSwitch({ showExtra, onClick, className }: { showExtra: boolean, onClick: () => void, className?: string }) {
  const classes = 'w-5 h-5 action-icon';
  return (
    <div className={className ?? ''}>
      {!showExtra ? 
        <VscAdd className={classes} onClick={onClick}/> : 
        <VscRemove className={classes} onClick={onClick}/>}
    </div>
  );
}

interface ControlProps {
  onRefresh: () => void;
  printTypes: number;
  onChangePrintTypes: (printTypes: number) => void;
  goalOptions: GoalOptions;
  onChangeGoalOptions: (newOptions: GoalOptions) => void;
};

function Controls(props: ControlProps) {
  const { onRefresh, printTypes, onChangePrintTypes, goalOptions, onChangeGoalOptions } = props;
  const [showExtra, setShowExtra] = React.useState<boolean>(false);

  return (
    <div className="flex flex-col mt-2">
      <div className={"flex flex-row gap-x-2"
        + (showExtra ? ' mb-2' : ' hidden')}>
        {/* Margin */}
        <vscode-label><span className='normal'>Margin</span></vscode-label>
        <vscode-single-select
          value={goalOptions.margin?.toString() ?? '0'}
          position='above'
          onchange={(e) => onChangeGoalOptions({ margin: +e.currentTarget.value })}
        >
          <vscode-option value='0'>default</vscode-option>
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
          value={goalOptions.maxHypBoxes?.toString() ?? '0'}
          position='above'
          onchange={(e) => onChangeGoalOptions({ maxHypBoxes: +e.currentTarget.value })}
        >
          <vscode-option value='0'>default</vscode-option>
          <vscode-option>2</vscode-option>
          <vscode-option>3</vscode-option>
          <vscode-option>4</vscode-option>
          <vscode-option>5</vscode-option>
          <vscode-option>6</vscode-option>
          <vscode-option>7</vscode-option>
          <vscode-option>8</vscode-option>
          <vscode-option>9</vscode-option>
          <vscode-option>10</vscode-option>
          <vscode-option>20</vscode-option>
          <vscode-option>100</vscode-option>
        </vscode-single-select>
        {/* Max boxes */}
        <vscode-label><span className='normal'>Max&nbsp;boxes</span></vscode-label>
        <vscode-single-select
          value={goalOptions.maxBoxes?.toString() ?? '0'}
          position='above'
          onchange={(e) => onChangeGoalOptions({ maxBoxes: +e.currentTarget.value })}
        >
          <vscode-option value='0'>default</vscode-option>
          <vscode-option>2</vscode-option>
          <vscode-option>3</vscode-option>
          <vscode-option>4</vscode-option>
          <vscode-option>5</vscode-option>
          <vscode-option>6</vscode-option>
          <vscode-option>7</vscode-option>
          <vscode-option>8</vscode-option>
          <vscode-option>9</vscode-option>
          <vscode-option>10</vscode-option>
          <vscode-option>20</vscode-option>
          <vscode-option>100</vscode-option>
        </vscode-single-select>
      </div>
      <div className="flex flex-row mb-2 gap-x-2 items-center">
        {/* Refresh */}
        <vscode-button
          onClick={onRefresh}
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
          checked={goalOptions.color ?? true}
          onChange={(e) => onChangeGoalOptions({ color: e.currentTarget.checked })}
        />
        {/* Show extra options */}
        <ExtraSwitch className='ml-auto' showExtra={showExtra} onClick={() => setShowExtra(!showExtra)}/>
      </div>
    </div>
  );
}

export default function App() {
  const vscode = useVSCode();
  const bottomGoalRef = React.useRef<HTMLDivElement>(null);
  const [printTypes, setPrintTypes] = React.useState<number>(1);
  const [errorMessage, setErrorMessage] = React.useState<string>();
  const [goalOptions, setGoalOptions] = React.useState<GoalOptions>(
    vscode.getState()?.options ?? {}
  );
  const [goalstate, setGoalstate] = React.useState<Goalstate>();

  React.useEffect(() => {
    // If there is no saved state then request state restoration
    if (vscode.getState() === undefined) {
      vscode.postMessage({ 
        command: 'restore' 
      } satisfies GoalviewMessage<'restore'>);
    }
    vscode.postMessage({ 
      command: 'refresh', 
      data: goalOptions
    } satisfies GoalviewMessage<'refresh'>);
    // Note: Do not save undefined state to avoid sending the restore message several times
    vscode.setState<GoalviewState>({ options: goalOptions })
  }, [vscode, goalOptions]);

  React.useEffect(() => {
    const handler = (msg: MessageEvent<GoalviewMessage<MessageCommands>>) => {
      const message = msg.data;
      switch (message.command) {
        case 'update': {
          if (message.data) {
            setGoalstate(message.data.goalstate);
            setPrintTypes(Math.max(0, Math.min(message.data.printTypes | 0, 2)));
          }
          setErrorMessage('');
          break;
        }
        case 'restore': {
          if (message.data) {
            setGoalOptions(message.data.options);
          }
          break;
        }
        case 'error': {
          setErrorMessage(message.data);
          break;
        }
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  React.useEffect(() => {
    bottomGoalRef.current?.scrollIntoView({
      // behavior: "smooth",
      block: "end",
      inline: "nearest"
    });
  }, [goalstate]);

  return (
    <>
      {import.meta.env.DEV ? <vscode-dev-toolbar></vscode-dev-toolbar> : null}
      <div className="flex flex-col h-screen ml-2 mr-2">
        <div className="flex-1 overflow-auto">
        {/* <div className="flex-1"> */}
          <Goals goalstate={goalstate}/>
          <div ref={bottomGoalRef}/>
        </div>
        <div className={errorMessage ? 'term' : 'hidden'}>{errorMessage ? errorMessage : ''}</div>
        <Controls
          onRefresh={() => {
            vscode.postMessage({ 
              command: 'refresh', 
              data: goalOptions
            } satisfies GoalviewMessage<'refresh'>);
          }}
          printTypes={printTypes}
          onChangePrintTypes={(n: number) => {
            setPrintTypes(n);
            vscode.postMessage({ 
              command: 'print-types', 
              data: n 
            } satisfies GoalviewMessage<'print-types'>);
          }}
          goalOptions={goalOptions}
          onChangeGoalOptions={(newOptions) => setGoalOptions({ ...goalOptions, ...newOptions })}
        />
      </div>
    </>
  );
}
