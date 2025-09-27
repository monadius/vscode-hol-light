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

export type GoalOptions = {
  color?: boolean;
  margin?: number;
  maxBoxes?: number;
  maxHypBoxes?: number;
};

export type GoalviewState = {
    options: GoalOptions;
}

type Message<Command extends MessageCommands, T> = {
  command: Command;
  data: T;
}

type MessageOpt<Command extends MessageCommands, T> = {
  command: Command;
  data?: T;
}

type Messages = {
  'update': Message<'update', { goalstate: Goalstate; printTypes: number }>;
  'refresh': Message<'refresh', GoalOptions>;
  'restore': MessageOpt<'restore', GoalviewState>; 
  'print-types': Message<'print-types', number>;
  'error': Message<'error', string>;
  'constant-info': Message<'constant-info', { id: string, text: string | null }>;
}

export type MessageCommands = keyof Messages;

export type GoalviewMessage<Command extends MessageCommands> = Messages[Command];
