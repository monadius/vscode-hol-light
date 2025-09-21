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

export type MessageCommands = 'update' | 'refresh' | 'restore' | 'print-types';

type Message<Command extends MessageCommands, T> = {
  command: Command;
  data: T;
}

type MessageOpt<Command extends MessageCommands, T> = {
  command: Command;
  data?: T;
}

type UpdateMessage = Message<'update', { goalstate: Goalstate; printTypes: number }>;
type RefreshMessage = Message<'refresh', GoalOptions>;
type RestoreMessage = MessageOpt<'restore', GoalviewState>; 
type PrintTypesMessage = Message<'print-types', number>;

export type GoalviewMessage<Command extends MessageCommands> =
  Command extends 'update' ? UpdateMessage :
  Command extends 'refresh' ? RefreshMessage :
  Command extends 'restore' ? RestoreMessage :
  Command extends 'print-types' ? PrintTypesMessage :
  never;