import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Award,
  BookOpen,
  Briefcase,
  Bug,
  Clock3,
  Database,
  Flame,
  GraduationCap,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Trophy,
} from 'lucide-react'

import './App.css'

import {
  allChallenges,
  careerChallenges,
  debugModeChallenges,
  interviewChallenges,
  lessonsByTrack,
  schemaTables,
} from './data/gameContent'
import { getDatabaseSnapshot, runSql } from './lib/database'
import { compareResults, syntaxFeedback } from './lib/validation'
import type { Challenge, ProgressState, QueryResult, ValidationFeedback } from './types'

type View = 'dashboard' | 'learn' | 'practice' | 'career' | 'interview' | 'debug' | 'review' | 'schema'

const progressStorageKey = 'sql-practice-game-progress-v1'
const progressApiPath = '/api/progress'

const initialProgress: ProgressState = {
  completedIds: [],
  xp: 0,
  streak: 0,
  badges: [],
  incorrectIds: [],
  bestInterviewScore: 0,
  lastActiveDate: null,
}

const rankSteps = [
  { minXp: 0, label: 'SQL Intern' },
  { minXp: 350, label: 'Junior Analyst' },
  { minXp: 900, label: 'Business Analyst' },
  { minXp: 1700, label: 'Data Analyst' },
  { minXp: 2600, label: 'Senior Analyst' },
  { minXp: 3600, label: 'SQL Master' },
]

const trackLabels = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  joins: 'Joins',
  advanced: 'Advanced',
}

const viewMeta: Record<View, { label: string; icon: typeof LayoutDashboard }> = {
  dashboard: { label: 'Dashboard', icon: LayoutDashboard },
  learn: { label: 'Learn Mode', icon: GraduationCap },
  practice: { label: 'Practice Mode', icon: Sparkles },
  career: { label: 'Career Mode', icon: Briefcase },
  interview: { label: 'Interview Mode', icon: Clock3 },
  debug: { label: 'Debug Mode', icon: Bug },
  review: { label: 'Review Mode', icon: ShieldCheck },
  schema: { label: 'Schema', icon: Database },
}

const todayKey = () => new Date().toISOString().slice(0, 10)

const loadLocalProgress = (): ProgressState => {
  const raw = localStorage.getItem(progressStorageKey)
  if (!raw) {
    return initialProgress
  }

  try {
    return { ...initialProgress, ...JSON.parse(raw) }
  } catch {
    return initialProgress
  }
}

const normalizeProgress = (value: unknown): ProgressState => ({
  ...initialProgress,
  ...(typeof value === 'object' && value !== null ? value : {}),
})

const loadProgress = async (): Promise<ProgressState> => {
  try {
    const response = await fetch(progressApiPath, { cache: 'no-store' })
    if (!response.ok) {
      throw new Error(`Failed to load progress: ${response.status}`)
    }

    const data = (await response.json()) as ProgressState
    return normalizeProgress(data)
  } catch {
    return loadLocalProgress()
  }
}

const saveProgress = async (progress: ProgressState) => {
  localStorage.setItem(progressStorageKey, JSON.stringify(progress))

  try {
    await fetch(progressApiPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(progress),
    })
  } catch {
    // Keep local storage as a fallback if the local file API is unavailable.
  }
}

const getRank = (xp: number) => {
  const current = [...rankSteps].reverse().find((step) => xp >= step.minXp) ?? rankSteps[0]
  const next = rankSteps.find((step) => step.minXp > xp) ?? null
  const progressMax = next ? next.minXp - current.minXp : 500
  const progressValue = next ? xp - current.minXp : progressMax

  return {
    current,
    next,
    progressPct: Math.min(100, Math.round((progressValue / progressMax) * 100)),
  }
}

const deriveBadges = (completed: Challenge[], bestInterviewScore: number) => {
  const badges = new Set<string>()

  if (completed.length >= 1) badges.add('First Query Cleared')
  if (completed.filter((challenge) => challenge.track === 'beginner').length >= 10) badges.add('Beginner Path Complete')
  if (completed.filter((challenge) => challenge.track === 'joins').length >= 10) badges.add('Join Tactician')
  if (completed.filter((challenge) => challenge.mode === 'career').length >= 10) badges.add('Business Operator')
  if (completed.filter((challenge) => challenge.difficulty === 'Boss').length >= 5) badges.add('Boss Breaker')
  if (bestInterviewScore >= 85) badges.add('Interview Ready')
  if (completed.length >= 35) badges.add('Momentum Builder')

  return [...badges]
}

const sqlKeywords = new Set([
  'SELECT',
  'FROM',
  'WHERE',
  'AND',
  'OR',
  'NOT',
  'ORDER',
  'BY',
  'LIMIT',
  'DISTINCT',
  'GROUP',
  'HAVING',
  'AS',
  'CASE',
  'WHEN',
  'THEN',
  'ELSE',
  'END',
  'LIKE',
  'IS',
  'NULL',
  'INNER',
  'LEFT',
  'JOIN',
  'ON',
  'COUNT',
  'SUM',
  'AVG',
  'MIN',
  'MAX',
  'WITH',
  'OVER',
  'PARTITION',
  'ROW_NUMBER',
  'RANK',
  'DENSE_RANK',
  'LAG',
  'LEAD',
  'ROUND',
  'STRFTIME',
])

const tokenizeSql = (sql: string) =>
  sql.match(/'[^']*'|"[^"]*"|--.*$|\b[a-zA-Z_][a-zA-Z0-9_]*\b|\d+(?:\.\d+)?|[(),;*=<>.+/-]|\s+|./gm) ?? []

const renderSqlTokens = (sql: string) =>
  tokenizeSql(sql).map((token, index) => {
    if (/^\s+$/.test(token)) {
      return <Fragment key={`${token}-${index}`}>{token}</Fragment>
    }

    let className = 'sql-token sql-plain'

    if (/^'[^']*'$|^"[^"]*"$/.test(token)) {
      className = 'sql-token sql-string'
    } else if (/^\d+(?:\.\d+)?$/.test(token)) {
      className = 'sql-token sql-number'
    } else if (sqlKeywords.has(token.toUpperCase())) {
      className = 'sql-token sql-keyword'
    } else if (/^[(),;*=<>.+/-]$/.test(token)) {
      className = 'sql-token sql-symbol'
    } else if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(token)) {
      className = 'sql-token sql-identifier'
    }

    return (
      <span key={`${token}-${index}`} className={className}>
        {token}
      </span>
    )
  })

const renderTextWithInlineCode = (text: string): ReactNode[] =>
  text.split(/(`[^`]+`)/g).filter(Boolean).map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      const code = part.slice(1, -1)
      return (
        <code key={`${code}-${index}`} className="inline-code">
          {renderSqlTokens(code)}
        </code>
      )
    }

    return <Fragment key={`${part}-${index}`}>{part}</Fragment>
  })

const getBaseSelectPlaceholder = (challenge: Challenge) => {
  const sql = challenge.solutionSql.toUpperCase()

  if (sql.includes('COUNT(')) return '  COUNT(*) AS metric_name'
  if (sql.includes('SUM(')) return '  SUM(numeric_column) AS metric_name'
  if (sql.includes('AVG(')) return '  AVG(numeric_column) AS metric_name'
  if (sql.includes('MIN(') && sql.includes('MAX(')) return '  MIN(column_name) AS min_value,\n  MAX(column_name) AS max_value'
  if (sql.includes('MIN(')) return '  MIN(column_name) AS min_value'
  if (sql.includes('MAX(')) return '  MAX(column_name) AS max_value'
  if (sql.includes('CASE')) return '  column_name,\n  CASE\n    WHEN condition_1 THEN result_1\n    ELSE fallback_result\n  END AS label_name'
  if (sql.includes('DISTINCT')) return '  DISTINCT column_name'
  if (sql.includes('OVER (')) return '  column_name,\n  window_value'
  if (sql.includes('GROUP BY')) return '  grouping_column,\n  metric_value'

  return '  column_a,\n  column_b'
}

const getLearnModePatternSql = (challenge: Challenge) => {
  const sql = challenge.solutionSql.toUpperCase()
  const joinCount = Math.max(challenge.relevantTables.length - 1, 0)
  const lines = ['SELECT', getBaseSelectPlaceholder(challenge), 'FROM table_name']

  if (sql.includes('LEFT JOIN')) {
    for (let index = 0; index < joinCount; index += 1) {
      lines.push(`LEFT JOIN joined_table_${index + 1} ON join_condition_${index + 1}`)
    }
  } else if (sql.includes('INNER JOIN') || sql.includes('JOIN')) {
    for (let index = 0; index < joinCount; index += 1) {
      lines.push(`INNER JOIN joined_table_${index + 1} ON join_condition_${index + 1}`)
    }
  }

  if (sql.includes('WHERE')) lines.push('WHERE condition_1')
  if (sql.includes(' AND ')) lines.push('  AND condition_2')
  if (sql.includes(' OR ')) lines.push('  OR condition_3')
  if (sql.includes('GROUP BY')) lines.push('GROUP BY grouping_column')
  if (sql.includes('HAVING')) lines.push('HAVING aggregate_condition')
  if (sql.includes('ORDER BY')) lines.push('ORDER BY sort_column DESC')
  if (sql.includes('LIMIT')) lines.push('LIMIT n')

  return `${lines.join('\n')};`
}

const getLearnModePracticeSql = (challenge: Challenge) => {
  const sql = challenge.solutionSql.toUpperCase()
  const primaryTable = challenge.relevantTables[0] ?? 'table_name'
  const joinTables = challenge.relevantTables.slice(1)
  const lines = ['SELECT']

  if (sql.includes('COUNT(')) {
    lines.push('  COUNT(*) AS metric_name')
  } else if (sql.includes('SUM(')) {
    lines.push('  SUM(numeric_column) AS metric_name')
  } else if (sql.includes('AVG(')) {
    lines.push('  AVG(numeric_column) AS metric_name')
  } else if (sql.includes('MIN(') && sql.includes('MAX(')) {
    lines.push('  MIN(column_name) AS min_value,')
    lines.push('  MAX(column_name) AS max_value')
  } else if (sql.includes('CASE')) {
    lines.push('  -- choose the columns you need,')
    lines.push('  CASE')
    lines.push('    WHEN -- condition_1 THEN -- result_1')
    lines.push('    ELSE -- fallback_result')
    lines.push('  END AS label_name')
  } else if (sql.includes('DISTINCT')) {
    lines.push('  DISTINCT -- unique column')
  } else if (sql.includes('OVER (')) {
    lines.push('  -- keep the row-level columns you need,')
    lines.push('  -- add the window calculation')
  } else if (sql.includes('GROUP BY')) {
    lines.push('  -- grouping column,')
    lines.push('  -- aggregate value')
  } else {
    lines.push('  -- choose the columns you need')
  }

  lines.push(`FROM ${primaryTable}`)

  if (sql.includes('LEFT JOIN')) {
    joinTables.forEach((table) => {
      lines.push(`LEFT JOIN ${table} ON -- join condition`)
    })
  } else if (sql.includes('INNER JOIN') || sql.includes('JOIN')) {
    joinTables.forEach((table) => {
      lines.push(`INNER JOIN ${table} ON -- join condition`)
    })
  }

  if (sql.includes('WHERE')) lines.push('WHERE -- add the filter')
  if (sql.includes(' AND ')) lines.push('  AND -- add the second condition')
  if (sql.includes(' OR ')) lines.push('  OR -- add the alternate condition')
  if (sql.includes('GROUP BY')) lines.push('GROUP BY -- add the grouping column')
  if (sql.includes('HAVING')) lines.push('HAVING -- filter grouped results')
  if (sql.includes('ORDER BY')) lines.push('ORDER BY -- choose the sort column')
  if (sql.includes('LIMIT')) lines.push('LIMIT -- row count')

  return `${lines.join('\n')};`
}

const getEditorSeedSql = (challenge: Challenge, view: View) => {
  if (view === 'learn') {
    return getLearnModePracticeSql(challenge)
  }

  return challenge.brokenSql ?? challenge.starterSql
}

const learnChallenges = [
  ...lessonsByTrack.beginner,
  ...lessonsByTrack.intermediate,
  ...lessonsByTrack.joins,
  ...lessonsByTrack.advanced,
]

const App = () => {
  const [view, setView] = useState<View>('dashboard')
  const [progress, setProgress] = useState<ProgressState>(initialProgress)
  const [selectedChallengeId, setSelectedChallengeId] = useState<string>('beginner-01')
  const [editorSql, setEditorSql] = useState<string>(getEditorSeedSql(lessonsByTrack.beginner[0], 'learn'))
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null)
  const [feedback, setFeedback] = useState<ValidationFeedback>({
    status: 'idle',
    title: 'Ready to query',
    message: 'Run a challenge query to validate your answer against the expected result.',
  })
  const [hintStep, setHintStep] = useState(0)
  const [isRunning, setIsRunning] = useState(false)
  const [databasePreview, setDatabasePreview] = useState<Awaited<ReturnType<typeof getDatabaseSnapshot>> | null>(null)
  const [practiceTrackFilter, setPracticeTrackFilter] = useState<'all' | keyof typeof lessonsByTrack>('all')
  const [practiceDifficultyFilter, setPracticeDifficultyFilter] = useState<'all' | Challenge['difficulty']>('all')
  const [practiceSeed, setPracticeSeed] = useState(0)
  const [interviewSecondsLeft, setInterviewSecondsLeft] = useState<number | null>(null)
  const [taskMenuCollapsed, setTaskMenuCollapsed] = useState(false)
  const hasLoadedProgress = useRef(false)

  useEffect(() => {
    let cancelled = false

    const initializeProgress = async () => {
      const savedProgress = await loadProgress()
      if (!cancelled) {
        setProgress(savedProgress)
        hasLoadedProgress.current = true
      }
    }

    void initializeProgress()
    getDatabaseSnapshot().then(setDatabasePreview).catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!hasLoadedProgress.current) {
      return
    }

    void saveProgress(progress)
  }, [progress])

  const reviewChallenges = useMemo(
    () => allChallenges.filter((challenge) => progress.incorrectIds.includes(challenge.id)),
    [progress.incorrectIds],
  )

  const practicePool = useMemo(() => {
    return [
      ...lessonsByTrack.beginner,
      ...lessonsByTrack.intermediate,
      ...lessonsByTrack.joins,
      ...lessonsByTrack.advanced,
      ...careerChallenges,
    ].filter((challenge) => {
      const trackMatch = practiceTrackFilter === 'all' || challenge.track === practiceTrackFilter
      const difficultyMatch =
        practiceDifficultyFilter === 'all' || challenge.difficulty === practiceDifficultyFilter

      return trackMatch && difficultyMatch
    })
  }, [practiceDifficultyFilter, practiceTrackFilter])

  const practiceChallenge = useMemo(() => {
    if (practicePool.length === 0) {
      return null
    }

    return practicePool[practiceSeed % practicePool.length]
  }, [practicePool, practiceSeed])

  const currentChallenge = useMemo(() => {
    if (view === 'practice') {
      return practiceChallenge
    }

    return allChallenges.find((challenge) => challenge.id === selectedChallengeId) ?? lessonsByTrack.beginner[0]
  }, [practiceChallenge, selectedChallengeId, view])

  const completedChallenges = useMemo(
    () => allChallenges.filter((challenge) => progress.completedIds.includes(challenge.id)),
    [progress.completedIds],
  )

  const rank = useMemo(() => getRank(progress.xp), [progress.xp])
  const completionPct = Math.round((completedChallenges.length / allChallenges.length) * 100)
  const nextChallenge = useMemo(
    () => allChallenges.find((challenge) => !progress.completedIds.includes(challenge.id)) ?? null,
    [progress.completedIds],
  )
  const currentLearnChallengeIndex = useMemo(
    () => learnChallenges.findIndex((challenge) => challenge.id === currentChallenge?.id),
    [currentChallenge?.id],
  )
  const nextLearnChallenge = useMemo(
    () =>
      currentLearnChallengeIndex >= 0 && currentLearnChallengeIndex < learnChallenges.length - 1
        ? learnChallenges[currentLearnChallengeIndex + 1]
        : null,
    [currentLearnChallengeIndex],
  )

  useEffect(() => {
    if (!currentChallenge) {
      return
    }

    setEditorSql(getEditorSeedSql(currentChallenge, view))
    setHintStep(0)
    setFeedback({
      status: 'idle',
      title: currentChallenge.title,
      message: currentChallenge.task,
    })
    setQueryResult(null)

    if (view === 'interview' && currentChallenge.timeLimitSec) {
      setInterviewSecondsLeft(currentChallenge.timeLimitSec)
    } else {
      setInterviewSecondsLeft(null)
    }
  }, [currentChallenge?.id, view])

  useEffect(() => {
    if (view !== 'interview' || interviewSecondsLeft === null || interviewSecondsLeft <= 0) {
      return
    }

    const timer = window.setTimeout(() => {
      setInterviewSecondsLeft((seconds) => (seconds === null ? seconds : seconds - 1))
    }, 1000)

    return () => window.clearTimeout(timer)
  }, [interviewSecondsLeft, view])

  const markChallengeResult = (challenge: Challenge, wasSuccessful: boolean) => {
    setProgress((current) => {
      const completedIds = wasSuccessful
        ? Array.from(new Set([...current.completedIds, challenge.id]))
        : current.completedIds

      const incorrectIds = wasSuccessful
        ? current.incorrectIds.filter((id) => id !== challenge.id)
        : Array.from(new Set([...current.incorrectIds, challenge.id]))

      const alreadyCompleted = current.completedIds.includes(challenge.id)
      const xp = wasSuccessful && !alreadyCompleted ? current.xp + challenge.xpReward : current.xp
      const streak =
        wasSuccessful && current.lastActiveDate !== todayKey()
          ? current.streak + 1
          : wasSuccessful
            ? current.streak
            : current.streak

      const bestInterviewScore =
        challenge.mode === 'interview' && wasSuccessful
          ? Math.max(current.bestInterviewScore, Math.max(0, Math.min(100, Math.round(((interviewSecondsLeft ?? 0) / (challenge.timeLimitSec ?? 1)) * 100))))
          : current.bestInterviewScore

      const completed = allChallenges.filter((candidate) => completedIds.includes(candidate.id))

      return {
        completedIds,
        xp,
        streak,
        incorrectIds,
        bestInterviewScore,
        lastActiveDate: wasSuccessful ? todayKey() : current.lastActiveDate,
        badges: deriveBadges(completed, bestInterviewScore),
      }
    })
  }

  const handleRun = async () => {
    if (!currentChallenge) {
      return
    }

    setIsRunning(true)
    try {
      const userResult = await runSql(editorSql)
      setQueryResult(userResult)

      const expectedResult = await runSql(currentChallenge.solutionSql)
      const validation = compareResults(currentChallenge, editorSql, userResult, expectedResult)
      setFeedback(validation)
      markChallengeResult(currentChallenge, validation.status === 'success')
    } catch (error) {
      setFeedback(syntaxFeedback(error))
      markChallengeResult(currentChallenge, false)
      setQueryResult(null)
    } finally {
      setIsRunning(false)
    }
  }

  const handleEditorKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.ctrlKey && event.key === 'Enter' && !isRunning) {
      event.preventDefault()
      void handleRun()
    }
  }

  const selectChallenge = (challenge: Challenge) => {
    setSelectedChallengeId(challenge.id)
    setTaskMenuCollapsed(true)
    if (view === 'practice') {
      setView('learn')
    }
  }

  const randomizePracticeChallenge = () => {
    setPracticeSeed((value) => value + 1)
  }

  const handleAdvanceLearnLesson = () => {
    if (nextLearnChallenge) {
      setSelectedChallengeId(nextLearnChallenge.id)
      setTaskMenuCollapsed(true)
      return
    }

    setView('dashboard')
    setTaskMenuCollapsed(false)
  }

  const getLearnModeTheory = (challenge: Challenge) => {
    const conceptLabel = challenge.concept
    const exampleQuery = getLearnModePatternSql(challenge)
    const fallbackMentalModel = challenge.explanation.replace(/^This query works because\s*/i, '')

    return {
      learningGoal:
        challenge.lessonContent?.summary ??
        `In this lesson, you are learning ${conceptLabel} and how it changes the rows or columns returned by a query.`,
      theory:
        challenge.lessonContent?.theory ??
        `${challenge.explanation} ${challenge.analystUseCase}`,
      pattern:
        challenge.lessonContent?.pattern ??
        `Start with the table you need, then apply ${conceptLabel} to shape the answer.`,
      mentalModel:
        challenge.lessonContent?.exampleWalkthrough ??
        (fallbackMentalModel.charAt(0).toUpperCase() + fallbackMentalModel.slice(1)),
      keyTakeaway:
        challenge.lessonContent?.keyTakeaway ??
        challenge.followUp ??
        'Try changing one part of the query and watch how the result changes.',
      exampleQuery,
    }
  }

  const renderChallengeList = (challenges: Challenge[]) => (
    <div className="challenge-list">
      {challenges.map((challenge) => {
        const completed = progress.completedIds.includes(challenge.id)
        const active = currentChallenge?.id === challenge.id

        return (
          <button
            key={challenge.id}
            type="button"
            className={`challenge-card ${active ? 'active' : ''}`}
            onClick={() => selectChallenge(challenge)}
          >
            <div className="challenge-topline">
              <span>{challenge.title}</span>
              {completed ? <ShieldCheck size={16} /> : <Play size={16} />}
            </div>
            <p>{challenge.concept}</p>
            <div className="challenge-meta">
              <span>{challenge.difficulty}</span>
              <span>{challenge.xpReward} XP</span>
            </div>
          </button>
        )
      })}
    </div>
  )

  const modeChallenges = () => {
    switch (view) {
      case 'learn':
        return (
          <>
            {Object.entries(lessonsByTrack).map(([track, challenges]) => (
              <section key={track} className="mode-section">
                <div className="section-heading">
                  <h3>{trackLabels[track as keyof typeof trackLabels]}</h3>
                  <span>{challenges.length} lessons</span>
                </div>
                {renderChallengeList(challenges)}
              </section>
            ))}
          </>
        )
      case 'career':
        return renderChallengeList(careerChallenges)
      case 'interview':
        return renderChallengeList(interviewChallenges)
      case 'debug':
        return renderChallengeList(debugModeChallenges)
      case 'review':
        return reviewChallenges.length > 0 ? (
          renderChallengeList(reviewChallenges)
        ) : (
          <div className="empty-state">You have no review items yet. Missed challenges will land here automatically.</div>
        )
      default:
        return null
    }
  }

  const renderResultTable = (result: QueryResult | null) => {
    if (!result) {
      return <div className="empty-state">No result yet. Run the current SQL to inspect output.</div>
    }

    return (
      <div className="table-shell">
        <table>
          <thead>
            <tr>
              {result.columns.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, rowIndex) => (
              <tr key={`${rowIndex}-${row.join('-')}`}>
                {row.map((cell, cellIndex) => (
                  <td key={`${rowIndex}-${cellIndex}`}>{cell === null ? 'NULL' : String(cell)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">SQL</div>
          <div>
            <h1>Analyst Quest</h1>
            <p>Learn SQL like the job depends on it.</p>
          </div>
        </div>

        <div className="rank-panel">
          <div className="rank-header">
            <span>{rank.current.label}</span>
            <strong>{progress.xp} XP</strong>
          </div>
          <div className="progress-bar">
            <span style={{ width: `${rank.progressPct}%` }} />
          </div>
          <small>{rank.next ? `${rank.progressPct}% to ${rank.next.label}` : 'Max rank reached'}</small>
        </div>

        <nav className="nav-list">
          {Object.entries(viewMeta).map(([viewKey, meta]) => {
            const Icon = meta.icon
            return (
              <button
                key={viewKey}
                type="button"
                className={`nav-button ${view === viewKey ? 'active' : ''}`}
                onClick={() => setView(viewKey as View)}
              >
                <Icon size={18} />
                <span>{meta.label}</span>
              </button>
            )
          })}
        </nav>

        <div className="sidebar-foot">
          <div className="mini-stat">
            <Flame size={16} />
            <span>{progress.streak} day streak</span>
          </div>
          <div className="mini-stat">
            <Trophy size={16} />
            <span>{completionPct}% complete</span>
          </div>
        </div>
      </aside>

      <main className="main-shell">
        {view === 'dashboard' ? (
          <section className="dashboard">
            <div className="hero-panel">
              <div>
                <span className="eyebrow">Career progression</span>
                <h2>Go from SQL Intern to SQL Master with real analyst missions.</h2>
                <p>
                  Work through lessons, random drills, ecommerce missions, timed interview prompts, and broken-query debugging
                  against a live in-browser SQLite dataset.
                </p>
              </div>
              <div className="hero-grid">
                <div className="metric-card">
                  <span>Completed</span>
                  <strong>{completedChallenges.length}</strong>
                  <small>of {allChallenges.length} total challenges</small>
                </div>
                <div className="metric-card">
                  <span>Badges</span>
                  <strong>{progress.badges.length}</strong>
                  <small>earned through milestones</small>
                </div>
                <div className="metric-card">
                  <span>Interview best</span>
                  <strong>{progress.bestInterviewScore}</strong>
                  <small>score out of 100</small>
                </div>
              </div>
            </div>

            <div className="dashboard-grid">
              <section className="panel">
                <div className="section-heading">
                  <h3>Learning Path</h3>
                  <span>Structured progression</span>
                </div>
                <div className="path-grid">
                  {rankSteps.map((step, index) => (
                    <div key={step.label} className={`path-step ${progress.xp >= step.minXp ? 'reached' : ''}`}>
                      <strong>{index + 1}</strong>
                      <span>{step.label}</span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="panel">
                <div className="section-heading">
                  <h3>Recommended Next</h3>
                  <span>Keep momentum</span>
                </div>
                {nextChallenge ? (
                  <div className="next-card">
                    <h4>{nextChallenge.title}</h4>
                    <p>{nextChallenge.task}</p>
                    <button type="button" className="primary-button" onClick={() => {
                      setView(nextChallenge.mode === 'career' ? 'career' : nextChallenge.mode === 'interview' ? 'interview' : nextChallenge.mode === 'debug' ? 'debug' : 'learn')
                      setSelectedChallengeId(nextChallenge.id)
                    }}>
                      Open challenge
                    </button>
                  </div>
                ) : (
                  <div className="empty-state">You have cleared the full path. Use Practice Mode to keep sharpening.</div>
                )}
              </section>

              <section className="panel">
                <div className="section-heading">
                  <h3>Badges</h3>
                  <span>Progress markers</span>
                </div>
                <div className="badge-list">
                  {progress.badges.length > 0 ? (
                    progress.badges.map((badge) => (
                      <div key={badge} className="badge-pill">
                        <Award size={14} />
                        <span>{badge}</span>
                      </div>
                    ))
                  ) : (
                    <div className="empty-state">Your first badge unlocks after the first successful challenge.</div>
                  )}
                </div>
              </section>

              <section className="panel">
                <div className="section-heading">
                  <h3>Dataset Overview</h3>
                  <span>Business-ready schema</span>
                </div>
                <div className="schema-preview-grid">
                  {schemaTables.map((table) => (
                    <div key={table.name} className="schema-preview-card">
                      <strong>{table.name}</strong>
                      <p>{table.description}</p>
                      <small>{table.columns.length} columns</small>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </section>
        ) : view === 'schema' ? (
          <section className="schema-layout">
            <div className="panel">
              <div className="section-heading">
                <h3>Schema Viewer</h3>
                <span>Know your tables before you write SQL</span>
              </div>
              <div className="schema-grid">
                {schemaTables.map((table) => (
                  <article key={table.name} className="schema-card">
                    <h4>{table.name}</h4>
                    <p>{table.description}</p>
                    <ul>
                      {table.columns.map((column) => (
                        <li key={`${table.name}-${column.name}`}>
                          <strong>{column.name}</strong>
                          <span>{column.type}</span>
                          <small>{column.description}</small>
                        </li>
                      ))}
                    </ul>
                  </article>
                ))}
              </div>
            </div>

            <div className="panel">
              <div className="section-heading">
                <h3>Sample Rows</h3>
                <span>Preview the data grain</span>
              </div>
              {databasePreview ? (
                <div className="preview-stack">
                  <div>
                    <h4>customers</h4>
                    {renderResultTable(databasePreview.customers)}
                  </div>
                  <div>
                    <h4>orders</h4>
                    {renderResultTable(databasePreview.orders)}
                  </div>
                  <div>
                    <h4>products</h4>
                    {renderResultTable(databasePreview.products)}
                  </div>
                </div>
              ) : (
                <div className="empty-state">Loading sample rows…</div>
              )}
            </div>
          </section>
        ) : (
          <section className={`workspace ${taskMenuCollapsed ? 'tasks-collapsed' : ''}`}>
            {!taskMenuCollapsed ? (
              <div className="panel task-panel">
                <div className="section-heading">
                  <h3>{viewMeta[view].label}</h3>
                  <span>
                    {view === 'practice'
                      ? 'Random drills by topic and difficulty'
                      : 'Pick a challenge and solve it against the live dataset'}
                  </span>
                </div>

                {view === 'practice' ? (
                  <div className="practice-toolbar">
                    <label>
                      Topic
                      <select value={practiceTrackFilter} onChange={(event) => setPracticeTrackFilter(event.target.value as typeof practiceTrackFilter)}>
                        <option value="all">All topics</option>
                        <option value="beginner">Beginner</option>
                        <option value="intermediate">Intermediate</option>
                        <option value="joins">Joins</option>
                        <option value="advanced">Advanced</option>
                      </select>
                    </label>
                    <label>
                      Difficulty
                      <select
                        value={practiceDifficultyFilter}
                        onChange={(event) => setPracticeDifficultyFilter(event.target.value as typeof practiceDifficultyFilter)}
                      >
                        <option value="all">All levels</option>
                        <option value="Beginner">Beginner</option>
                        <option value="Intermediate">Intermediate</option>
                        <option value="Advanced">Advanced</option>
                        <option value="Boss">Boss</option>
                      </select>
                    </label>
                    <button type="button" className="secondary-button" onClick={randomizePracticeChallenge}>
                      <RefreshCw size={16} />
                      <span>Randomize</span>
                    </button>
                  </div>
                ) : null}

                {view === 'practice' ? (
                  practiceChallenge ? (
                    <div className="practice-focus">
                      <div className="challenge-card active">
                        <div className="challenge-topline">
                          <span>{practiceChallenge.title}</span>
                          <Sparkles size={16} />
                        </div>
                        <p>{practiceChallenge.task}</p>
                        <div className="challenge-meta">
                          <span>{practiceChallenge.track}</span>
                          <span>{practiceChallenge.difficulty}</span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="empty-state">No challenge matches your current practice filters.</div>
                  )
                ) : (
                  modeChallenges()
                )}
              </div>
            ) : null}

            <div className="content-column">
              {currentChallenge ? (
                <>
                  <div className="workspace-toolbar">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => setTaskMenuCollapsed((collapsed) => !collapsed)}
                    >
                      {taskMenuCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
                      <span>{taskMenuCollapsed ? 'Show tasks' : 'Hide tasks'}</span>
                    </button>
                  </div>
                  <div className="panel detail-panel">
                    {view === 'learn' ? (
                      <>
                        <div className="detail-header">
                          <div>
                            <span className="eyebrow">Lesson first</span>
                            <h3>{currentChallenge.title}</h3>
                          </div>
                          <div className="lesson-chip">
                            <BookOpen size={16} />
                            <span>{currentChallenge.concept}</span>
                          </div>
                        </div>
                        <p className="context">{currentChallenge.businessContext}</p>
                        <div className="learn-overview">
                          <div className="learn-card">
                            <strong>What you are learning</strong>
                            <p>{renderTextWithInlineCode(getLearnModeTheory(currentChallenge).learningGoal)}</p>
                          </div>
                          <div className="learn-card">
                            <strong>The idea behind it</strong>
                            <p>{renderTextWithInlineCode(getLearnModeTheory(currentChallenge).theory)}</p>
                          </div>
                          <div className="learn-card">
                            <strong>The SQL pattern</strong>
                            <p>{renderTextWithInlineCode(getLearnModeTheory(currentChallenge).pattern)}</p>
                          </div>
                        </div>
                        <div className="learn-example">
                          <div className="section-heading">
                            <h3>Example Pattern</h3>
                            <span>Study the structure, then solve the task with your own query</span>
                          </div>
                          <div className="example-code">
                            <pre>{renderSqlTokens(getLearnModeTheory(currentChallenge).exampleQuery)}</pre>
                          </div>
                        </div>
                        <div className="learn-overview learn-secondary">
                          <div className="learn-card">
                            <strong>Walkthrough</strong>
                            <p>{renderTextWithInlineCode(getLearnModeTheory(currentChallenge).mentalModel)}</p>
                          </div>
                          <div className="learn-card">
                            <strong>Why analysts use it</strong>
                            <p>{renderTextWithInlineCode(currentChallenge.analystUseCase)}</p>
                          </div>
                          <div className="learn-card">
                            <strong>Key takeaway</strong>
                            <p>{renderTextWithInlineCode(getLearnModeTheory(currentChallenge).keyTakeaway)}</p>
                          </div>
                        </div>
                        <div className="detail-grid learn-detail-grid">
                          <div>
                            <strong>Your practice task</strong>
                            <p>{renderTextWithInlineCode(currentChallenge.task)}</p>
                          </div>
                          <div>
                            <strong>Tables to use</strong>
                            <p>{renderTextWithInlineCode(currentChallenge.relevantTables.join(', '))}</p>
                          </div>
                          <div>
                            <strong>Expected result shape</strong>
                            <p>{renderTextWithInlineCode(currentChallenge.expectedColumns.join(', '))}</p>
                          </div>
                          <div>
                            <strong>Watch out for</strong>
                            <p>{renderTextWithInlineCode(currentChallenge.commonMistake)}</p>
                          </div>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="detail-header">
                          <div>
                            <span className="eyebrow">{currentChallenge.roleFocus}</span>
                            <h3>{currentChallenge.title}</h3>
                          </div>
                          {view === 'interview' && interviewSecondsLeft !== null ? (
                            <div className="countdown">{interviewSecondsLeft}s</div>
                          ) : null}
                        </div>
                        <p className="context">{currentChallenge.businessContext}</p>
                        <div className="detail-grid">
                          <div>
                            <strong>Task</strong>
                            <p>{currentChallenge.task}</p>
                          </div>
                          <div>
                            <strong>Tables</strong>
                            <p>{currentChallenge.relevantTables.join(', ')}</p>
                          </div>
                          <div>
                            <strong>Concept</strong>
                            <p>{currentChallenge.concept}</p>
                          </div>
                          <div>
                            <strong>Expected shape</strong>
                            <p>{currentChallenge.expectedColumns.join(', ')}</p>
                          </div>
                        </div>
                      </>
                    )}
                  </div>

                  <div className="panel editor-panel">
                    <div className="editor-toolbar">
                      <div className="toolbar-title">
                        <Database size={16} />
                        <span>{view === 'learn' ? 'Your Turn' : 'SQLite Editor'}</span>
                      </div>
                      <div className="toolbar-actions">
                        {view === 'learn' ? (
                          <button type="button" className="secondary-button" onClick={() => setEditorSql(getLearnModePracticeSql(currentChallenge))}>
                            <BookOpen size={16} />
                            <span>Load Scaffold</span>
                          </button>
                        ) : null}
                        <button type="button" className="secondary-button" onClick={() => setEditorSql(getEditorSeedSql(currentChallenge, view))}>
                          <RefreshCw size={16} />
                          <span>Reset SQL</span>
                        </button>
                        <button type="button" className="primary-button" onClick={handleRun} disabled={isRunning}>
                          <Play size={16} />
                          <span>{isRunning ? 'Running…' : 'Run Query'}</span>
                        </button>
                      </div>
                    </div>
                    {view === 'learn' ? (
                      <p className="editor-intro">
                        Start from the example pattern above, then write the query that solves this lesson’s task.
                      </p>
                    ) : null}
                    <textarea
                      value={editorSql}
                      onChange={(event) => setEditorSql(event.target.value)}
                      onKeyDown={handleEditorKeyDown}
                      spellCheck={false}
                    />
                  </div>

                  <div className="result-grid">
                    <div className="panel">
                      <div className="section-heading">
                        <h3>Result Table</h3>
                        <span>Validation is result-based, not query-text based</span>
                      </div>
                      {renderResultTable(queryResult)}
                    </div>

                    <div className="panel">
                      <div className="section-heading">
                        <h3>Coach Feedback</h3>
                        <span>Hints, explanation, and analyst framing</span>
                      </div>
                      <div className={`feedback-box ${feedback.status}`}>
                        <strong>{feedback.title}</strong>
                        <p>{feedback.message}</p>
                        {feedback.detail ? <small>{feedback.detail}</small> : null}
                      </div>
                      {view === 'learn' && feedback.status === 'success' ? (
                        <button type="button" className="primary-button lesson-progress-button" onClick={handleAdvanceLearnLesson}>
                          <span>{nextLearnChallenge ? 'Next Lesson' : 'Finish Lessons'}</span>
                        </button>
                      ) : null}

                      <div className="hint-stack">
                        {currentChallenge.hints.slice(0, hintStep).map((hint, index) => (
                          <div key={`${currentChallenge.id}-hint-${index}`} className="hint-card">
                            <Search size={14} />
                            <span>{hint}</span>
                          </div>
                        ))}
                        {hintStep < currentChallenge.hints.length ? (
                          <button type="button" className="secondary-button" onClick={() => setHintStep((step) => step + 1)}>
                            Reveal hint {hintStep + 1}
                          </button>
                        ) : null}
                      </div>

                      <div className="explanation-stack">
                        <div>
                          <strong>Why it works</strong>
                          <p>{currentChallenge.explanation}</p>
                        </div>
                        <div>
                          <strong>Common beginner mistake</strong>
                          <p>{currentChallenge.commonMistake}</p>
                        </div>
                        <div>
                          <strong>How it shows up on the job</strong>
                          <p>{currentChallenge.analystUseCase}</p>
                        </div>
                        {currentChallenge.followUp ? (
                          <div>
                            <strong>Follow-up</strong>
                            <p>{currentChallenge.followUp}</p>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="panel">
                  <div className="empty-state">Choose a challenge to start.</div>
                </div>
              )}
            </div>
          </section>
        )}
      </main>
    </div>
  )
}

export default App
