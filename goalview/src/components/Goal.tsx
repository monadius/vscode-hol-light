import * as React from 'react';

import { ansiToReact } from '../utils/ansi';
import type { Goal } from '../../../src/types';

function Term({ term }: { term: string }) {
  return (
    <pre className="overflow-x-auto term">{ansiToReact(term)}</pre>
  );
}

export function Goal({ goal }: { goal: Goal }) {
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