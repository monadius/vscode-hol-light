export type Hypothesis = {
  label: string;
  term: string;
}

export type Goal = {
  hypotheses: Hypothesis[];
  term: string;
}

export type Goalstate = {
  goals: Goal[];
  subgoals: number /*int*/;
}