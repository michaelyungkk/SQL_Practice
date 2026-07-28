export type Track = 'beginner' | 'intermediate' | 'joins' | 'advanced'

export type GameMode =
  | 'learn'
  | 'practice'
  | 'career'
  | 'interview'
  | 'debug'
  | 'review'

export interface Challenge {
  id: string
  mode: GameMode
  track: Track | 'career' | 'interview' | 'debug'
  title: string
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced' | 'Boss'
  roleFocus: string
  businessContext: string
  concept: string
  task: string
  relevantTables: string[]
  starterSql: string
  solutionSql: string
  expectedColumns: string[]
  hints: string[]
  explanation: string
  commonMistake: string
  analystUseCase: string
  followUp?: string
  brokenSql?: string
  timeLimitSec?: number
  xpReward: number
  lessonContent?: LessonContent
}

export interface LessonContent {
  summary: string
  theory: string
  pattern: string
  exampleWalkthrough: string
  keyTakeaway: string
}

export interface SchemaColumn {
  name: string
  type: string
  description: string
}

export interface SchemaTable {
  name: string
  description: string
  columns: SchemaColumn[]
}

export interface QueryResult {
  columns: string[]
  rows: Array<Array<string | number | null>>
}

export interface ValidationFeedback {
  status: 'idle' | 'success' | 'error'
  title: string
  message: string
  detail?: string
}

export interface ProgressState {
  completedIds: string[]
  xp: number
  streak: number
  badges: string[]
  incorrectIds: string[]
  bestInterviewScore: number
  lastActiveDate: string | null
  lastView: string | null
  selectedChallengeId: string | null
  editorDrafts: Record<string, string>
  hintSteps: Record<string, number>
  queryHistory: Record<string, string[]>
  reviewSchedule: Record<
    string,
    {
      stage: number
      nextDue: string
      variantSeed: number
    }
  >
}
