import React from "react";
import { Goal } from "./Goal";
import type { Goalstate } from "../../../src/types";

export function Goals({ goalstate }: { goalstate?: Goalstate }) {
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