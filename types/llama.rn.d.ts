// Type-only stand-in for llama.rn (MIT, 0.13.0-rc.9), so the decision-model code typechecks
// without the native package. Only the decision types the package imports are declared here,
// copied from llama.rn's lib/typescript/types.d.ts. Nothing imports llama.rn at runtime.
declare module 'llama.rn' {
  type DecisionValue = string | number | boolean | null | readonly DecisionValue[] | { [key: string]: DecisionValue };

  export type DecisionContent = string | readonly DecisionValue[] | { [key: string]: DecisionValue };

  export type DecisionChoiceQuestion<K extends string = string> = {
    type: 'choice';
    instructions: DecisionContent;
    criteria: { [key in K]: string | null };
  };

  type DecisionScoreQuestion = {
    type: 'score';
    instructions: DecisionContent;
    criteria: readonly string[];
  };

  type DecisionNoulQuestion = {
    type: 'noul';
    instructions: DecisionContent;
    criteria?: { true?: string | null; false?: string | null; yes?: string | null; no?: string | null };
  };

  export type DecisionQuestion = DecisionChoiceQuestion | DecisionScoreQuestion | DecisionNoulQuestion;

  export type DecisionQuestions = Record<string, DecisionQuestion>;

  export type DecisionRequest<Q extends DecisionQuestions = DecisionQuestions> = {
    state: DecisionContent | null;
    questions: Q;
    files?: string[];
    images?: string[];
  };

  export type DecisionChoiceAnswer<K extends string = string> = {
    type: 'choice';
    choice: K;
    probabilities: { [key in K]: number };
    confidence: number;
  };

  export type DecisionScoreAnswer = {
    type: 'score';
    score: number;
    legend: Record<string, string>;
    probabilities: Record<string, number>;
    confidence: number;
  };

  export type DecisionNoulAnswer = {
    type: 'noul';
    noul: number;
  };

  export type DecisionAnswer = DecisionChoiceAnswer | DecisionScoreAnswer | DecisionNoulAnswer;

  type DecisionAnswerOf<Q extends DecisionQuestion> = Q extends DecisionChoiceQuestion<infer K>
    ? DecisionChoiceAnswer<K>
    : Q extends DecisionScoreQuestion
      ? DecisionScoreAnswer
      : DecisionNoulAnswer;

  export type DecisionResult<Q extends DecisionQuestions = DecisionQuestions> = {
    model: string;
    answers: { [id in keyof Q]: DecisionAnswerOf<Q[id]> };
    usage: { input_tokens: number; output_tokens: number };
  };
}
