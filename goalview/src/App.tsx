import React from 'react';

import "@vscode-elements/elements/dist/vscode-button";
import "@vscode-elements/elements/dist/vscode-checkbox";
import "@vscode-elements/elements/dist/vscode-divider";
import "@vscode-elements/elements/dist/vscode-label";
import "@vscode-elements/elements/dist/vscode-option";
import "@vscode-elements/elements/dist/vscode-single-select";
import "@vscode-elements/elements/dist/vscode-tab-header";
import "@vscode-elements/elements/dist/vscode-tab-panel";
import "@vscode-elements/elements/dist/vscode-tabs";

import { getVsCodeApi } from './utils/vscode';
import { Goals } from './components/Goals';
import { Controls } from './components/Controls';
import type { Goalstate, GoalviewState, GoalOptions, GoalviewMessage, MessageCommands } from '../../src/types';

import './App.css';
import { resolveConstantInfo } from './utils/info';

if (import.meta.env.DEV) {
  await import("@vscode-elements/webview-playground");
}

export default function App() {
  const vscode = getVsCodeApi();
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
        case 'constant-info': {
          resolveConstantInfo(message.data.id, message.data.text);
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
        <div className={errorMessage ? 'message' : 'hidden'}>{errorMessage ? errorMessage : ''}</div>
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