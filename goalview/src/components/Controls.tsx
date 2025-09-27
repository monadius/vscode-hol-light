import React from 'react';
import { VscAdd, VscRemove } from "react-icons/vsc";
import type { GoalOptions } from "../../../src/types";

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

export interface ControlProps {
  onRefresh: () => void;
  printTypes: number;
  onChangePrintTypes: (printTypes: number) => void;
  goalOptions: GoalOptions;
  onChangeGoalOptions: (newOptions: GoalOptions) => void;
};

export function Controls(props: ControlProps) {
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
