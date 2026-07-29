import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ArrowRight,
  Award,
  BookOpen,
  Briefcase,
  Bug,
  Clock3,
  Database,
  Flame,
  GraduationCap,
  LayoutDashboard,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Trophy,
  X,
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
import { getDatabaseSnapshot, getSchemaOverview, runSql } from './lib/database'
import { compareResults, syntaxFeedback } from './lib/validation'
import type { Challenge, ProgressState, QueryResult, ValidationFeedback } from './types'

type View = 'dashboard' | 'learn' | 'practice' | 'career' | 'interview' | 'debug' | 'review' | 'schema' | 'syntax'

type InterviewAttemptSummary = {
  status: 'success' | 'failed' | 'expired'
  score: number
  accuracyScore: number
  speedScore: number
  disciplineScore: number
  attempts: number
  hintsUsed: number
  timeLeft: number
}

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
  lastView: null,
  selectedChallengeId: null,
  editorDrafts: {},
  hintSteps: {},
  queryHistory: {},
  reviewSchedule: {},
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
  syntax: { label: 'Syntax Guide', icon: BookOpen },
}

const navGroups: Array<{ label: string; views: View[] }> = [
  { label: 'Learn', views: ['dashboard', 'learn'] },
  { label: 'Apply', views: ['practice', 'career', 'interview', 'debug', 'review'] },
  { label: 'Reference', views: ['schema', 'syntax'] },
]

const lessonTabs = [
  { id: 'concept', label: 'Concept' },
  { id: 'example', label: 'Example' },
  { id: 'task', label: 'Task' },
] as const

const workspaceTabs = [
  { id: 'results', label: 'Results' },
  { id: 'coach', label: 'Coach' },
  { id: 'explanation', label: 'Explanation' },
] as const

const syntaxReference = [
  {
    title: 'Select Rows',
    summary: 'Use `SELECT` and `FROM` to choose columns from one table.',
    syntax: `SELECT customer_name, country
FROM customers;`,
    note: 'Start here when you only need raw fields without filtering or grouping.',
  },
  {
    title: 'Select All Columns',
    summary: 'Use `SELECT *` when you need to inspect a table quickly.',
    syntax: `SELECT *
FROM customers;`,
    note: 'Useful for exploration, but in reporting queries it is usually better to list only the columns you need.',
  },
  {
    title: 'Choose Specific Columns',
    summary: 'List only the columns needed for the answer.',
    syntax: `SELECT product_name, price
FROM products;`,
    note: 'Treat the `SELECT` list as the shape of the final result.',
  },
  {
    title: 'Filter Rows',
    summary: 'Use `WHERE` to keep only rows that match a condition.',
    syntax: `SELECT product_name, price
FROM products
WHERE price > 120;`,
    note: 'Use single quotes for text values and leave numbers unquoted.',
  },
  {
    title: 'Combine Conditions',
    summary: 'Use `AND`, `OR`, and `NOT` to express multiple business rules.',
    syntax: `SELECT order_id, status, device_type
FROM orders
WHERE status = 'completed'
  AND device_type = 'Mobile';`,
    note: 'Add parentheses when mixing `AND` and `OR` so the intended logic is explicit.',
  },
  {
    title: 'Distinct Values',
    summary: 'Use `DISTINCT` to remove duplicate values from the selected output.',
    syntax: `SELECT DISTINCT acquisition_channel
FROM customers;`,
    note: '`DISTINCT` applies to the full selected row, not just one column in isolation.',
  },
  {
    title: 'Null Checks',
    summary: 'Use `IS NULL` and `IS NOT NULL` for missing values.',
    syntax: `SELECT order_id, campaign_id
FROM orders
WHERE campaign_id IS NULL;`,
    note: 'Do not write `= NULL` or `<> NULL`.',
  },
  {
    title: 'Pattern Matching',
    summary: 'Use `LIKE` with `%` wildcards to search partial text.',
    syntax: `SELECT *
FROM campaigns
WHERE campaign_name LIKE '%Brand%';`,
    note: '`%` matches any sequence of characters. Put the pattern in quotes.',
  },
  {
    title: 'Sort And Limit',
    summary: 'Use `ORDER BY` to control row order and `LIMIT` to keep only the top results.',
    syntax: `SELECT product_name, price
FROM products
ORDER BY price DESC
LIMIT 5;`,
    note: 'Sort first, then limit. Otherwise the top-N result is wrong.',
  },
  {
    title: 'Alias Columns',
    summary: 'Use `AS` to rename columns in the result.',
    syntax: `SELECT campaign_name AS campaign,
       channel AS marketing_channel,
       spend AS ad_spend
FROM campaigns;`,
    note: 'Aliases make output easier for people and dashboards to read.',
  },
  {
    title: 'Group And Aggregate',
    summary: 'Use aggregates like `COUNT`, `SUM`, and `AVG` after defining the row grain.',
    syntax: `SELECT segment, COUNT(*) AS customer_count
FROM customers
GROUP BY segment;`,
    note: 'Every selected non-aggregate column must also appear in `GROUP BY`.',
  },
  {
    title: 'Count Rows',
    summary: 'Use `COUNT(*)` to count rows in a table or group.',
    syntax: `SELECT COUNT(*) AS total_orders
FROM orders;`,
    note: 'This is the simplest aggregate metric and a good first check when validating dataset size.',
  },
  {
    title: 'Count Distinct',
    summary: 'Use `COUNT(DISTINCT ...)` when duplicates would overcount the business entity.',
    syntax: `SELECT COUNT(DISTINCT order_id) AS distinct_orders
FROM order_items;`,
    note: 'This is common when one order can appear in multiple line-item rows.',
  },
  {
    title: 'Sum Values',
    summary: 'Use `SUM(...)` to add values together.',
    syntax: `SELECT SUM(amount) AS paid_revenue
FROM payments
WHERE payment_status = 'paid';`,
    note: 'Filter first, then aggregate, so the metric matches the business definition.',
  },
  {
    title: 'Average Values',
    summary: 'Use `AVG(...)` to calculate a mean.',
    syntax: `SELECT AVG(price) AS avg_price
FROM products;`,
    note: 'Give the result an alias so the output column is readable.',
  },
  {
    title: 'Min And Max',
    summary: 'Use `MIN(...)` and `MAX(...)` together to compare extremes.',
    syntax: `SELECT MIN(price) AS min_price,
       MAX(price) AS max_price
FROM products;`,
    note: 'Multiple aggregate expressions can be returned in one summary row.',
  },
  {
    title: 'Filter Groups',
    summary: 'Use `HAVING` when the condition depends on an aggregate result.',
    syntax: `SELECT event_name, COUNT(*) AS event_count
FROM web_events
GROUP BY event_name
HAVING COUNT(*) >= 160;`,
    note: '`WHERE` filters rows before grouping. `HAVING` filters after grouping.',
  },
  {
    title: 'Inner Join',
    summary: 'Use `INNER JOIN ... ON ...` to keep rows that match in both tables.',
    syntax: `SELECT o.order_id, c.customer_name
FROM orders AS o
INNER JOIN customers AS c
  ON o.customer_id = c.customer_id;`,
    note: 'Always confirm which key links the two tables before you join.',
  },
  {
    title: 'Left Join',
    summary: 'Use `LEFT JOIN` when every row from the left table should stay in the result.',
    syntax: `SELECT o.order_id, c.campaign_name
FROM orders AS o
LEFT JOIN campaigns AS c
  ON o.campaign_id = c.campaign_id;`,
    note: 'Unmatched right-side columns come back as `NULL`.',
  },
  {
    title: 'Left Join With Null Filter',
    summary: 'Use a left join plus a null check to find missing relationships.',
    syntax: `SELECT c.customer_id, c.customer_name
FROM customers AS c
LEFT JOIN orders AS o
  ON c.customer_id = o.customer_id
WHERE o.order_id IS NULL;`,
    note: 'This is a common anti-join pattern for “who has no related record?” questions.',
  },
  {
    title: 'Case Logic',
    summary: 'Use `CASE WHEN` to create buckets, segments, or labels.',
    syntax: `SELECT product_name,
       price,
       CASE
         WHEN price < 50 THEN 'Entry'
         WHEN price < 120 THEN 'Core'
         ELSE 'Premium'
       END AS price_band
FROM products;`,
    note: 'Conditions run top to bottom, so the order of `WHEN` clauses matters.',
  },
  {
    title: 'Date Functions',
    summary: 'Use SQLite date helpers like `strftime` to group or filter by calendar periods.',
    syntax: `SELECT strftime('%Y-%m', payment_date) AS revenue_month,
       SUM(amount) AS revenue
FROM payments
WHERE payment_status = 'paid'
GROUP BY strftime('%Y-%m', payment_date);`,
    note: '`strftime` is useful for monthly cohorts, trends, and reporting periods.',
  },
  {
    title: 'Between Ranges',
    summary: 'Use `BETWEEN` to keep values inside an inclusive range.',
    syntax: `SELECT product_name, price
FROM products
WHERE price BETWEEN 50 AND 120;`,
    note: '`BETWEEN` includes both endpoints, so it is a concise way to write closed ranges.',
  },
  {
    title: 'In Lists',
    summary: 'Use `IN` when one column should match one of several values.',
    syntax: `SELECT customer_name, segment
FROM customers
WHERE segment IN ('New', 'VIP');`,
    note: '`IN` is a cleaner alternative to repeating many `OR` comparisons.',
  },
  {
    title: 'Exists Subquery',
    summary: 'Use `EXISTS` to check whether a related subquery returns at least one row.',
    syntax: `SELECT c.customer_id, c.customer_name
FROM customers AS c
WHERE EXISTS (
  SELECT 1
  FROM orders AS o
  WHERE o.customer_id = c.customer_id
);`,
    note: 'This pattern is useful when you only care whether a related record exists, not how many there are.',
  },
  {
    title: 'Coalesce Missing Values',
    summary: 'Use `COALESCE` to replace `NULL` with a fallback value.',
    syntax: `SELECT order_id,
       COALESCE(campaign_id, 0) AS campaign_id_fallback
FROM orders;`,
    note: '`COALESCE` returns the first non-null expression, which helps when a report needs a default.',
  },
  {
    title: 'Cast Values',
    summary: 'Use `CAST` to convert a value into another type.',
    syntax: `SELECT CAST(amount AS INTEGER) AS whole_dollars
FROM payments;`,
    note: 'Type conversion is helpful when formatting output or aligning values for comparison.',
  },
  {
    title: 'String Functions',
    summary: 'Use functions like `LOWER`, `TRIM`, `SUBSTR`, `LENGTH`, and `REPLACE` for text cleanup.',
    syntax: `SELECT REPLACE(LOWER(TRIM(channel)), 'paid ', '') AS clean_channel
FROM campaigns;`,
    note: 'Text functions help normalize noisy labels before grouping or filtering.',
  },
  {
    title: 'Date Arithmetic',
    summary: 'Use date modifiers to shift dates forward or backward.',
    syntax: `SELECT order_id,
       date(order_date, '+7 days') AS follow_up_date
FROM orders;`,
    note: 'SQLite date modifiers are useful for deadline checks and cohort windows.',
  },
  {
    title: 'Set Operations',
    summary: 'Use `UNION`, `UNION ALL`, `INTERSECT`, and `EXCEPT` to combine or compare result sets.',
    syntax: `SELECT customer_id FROM orders
UNION
SELECT customer_id FROM web_events;`,
    note: 'Use `UNION` when duplicates should be removed, and `UNION ALL` when they should be kept.',
  },
  {
    title: 'Data Cleaning',
    summary: 'Use functions like `LOWER` and `TRIM` to normalize text before analysis.',
    syntax: `SELECT DISTINCT LOWER(TRIM(acquisition_channel)) AS clean_channel
FROM customers
ORDER BY clean_channel;`,
    note: 'Light cleanup in SQL helps avoid duplicate-looking categories caused by formatting differences.',
  },
  {
    title: 'Subquery In WHERE',
    summary: 'Use a subquery when one query needs a comparison value from another query.',
    syntax: `SELECT payment_id, amount
FROM payments
WHERE amount > (
  SELECT AVG(amount)
  FROM payments
);`,
    note: 'The inner query runs first and supplies a value used by the outer filter.',
  },
  {
    title: 'Common Table Expressions',
    summary: 'Use `WITH` to name an intermediate query before selecting from it.',
    syntax: `WITH monthly_revenue AS (
  SELECT strftime('%Y-%m', payment_date) AS order_month,
         SUM(amount) AS revenue
  FROM payments
  WHERE payment_status = 'paid'
  GROUP BY strftime('%Y-%m', payment_date)
)
SELECT order_month, revenue
FROM monthly_revenue;`,
    note: 'CTEs make long queries easier to read and debug.',
  },
  {
    title: 'Row Number Ranking',
    summary: 'Use `ROW_NUMBER()` to assign a strict position after sorting.',
    syntax: `SELECT customer_name,
       total_spend,
       ROW_NUMBER() OVER (ORDER BY total_spend DESC) AS spend_rank
FROM customer_spend;`,
    note: 'This is useful when you need a unique 1, 2, 3 ranking even when values tie.',
  },
  {
    title: 'Rank And Dense Rank',
    summary: 'Use `RANK()` and `DENSE_RANK()` when ties matter.',
    syntax: `SELECT product_name,
       price,
       RANK() OVER (ORDER BY price DESC) AS price_rank,
       DENSE_RANK() OVER (ORDER BY price DESC) AS dense_price_rank
FROM products;`,
    note: '`RANK()` leaves gaps after ties. `DENSE_RANK()` does not.',
  },
  {
    title: 'Lag And Lead',
    summary: 'Use `LAG()` and `LEAD()` to compare one row to the previous or next row.',
    syntax: `SELECT customer_id,
       payment_date,
       amount,
       LAG(amount) OVER (PARTITION BY customer_id ORDER BY payment_date) AS previous_amount
FROM paid_orders;`,
    note: 'These functions are common in change-over-time and sequence analysis.',
  },
  {
    title: 'Partitioned Window Aggregates',
    summary: 'Use `PARTITION BY` to calculate metrics within each group while keeping row detail.',
    syntax: `SELECT shipping_country,
       amount,
       SUM(amount) OVER (PARTITION BY shipping_country) AS country_revenue
FROM paid_orders;`,
    note: 'Window functions do not collapse rows the way `GROUP BY` does.',
  },
  {
    title: 'Running Totals',
    summary: 'Use an ordered windowed `SUM(...) OVER (...)` to accumulate results over time.',
    syntax: `SELECT order_month,
       revenue,
       SUM(revenue) OVER (ORDER BY order_month) AS cumulative_revenue
FROM monthly_revenue;`,
    note: 'This pattern is common for revenue tracking and progress-to-date charts.',
  },
  {
    title: 'Window Frame',
    summary: 'Use a frame clause to control which surrounding rows are included in a window calculation.',
    syntax: `SELECT order_month,
       revenue,
       AVG(revenue) OVER (
         ORDER BY order_month
         ROWS BETWEEN 2 PRECEDING AND CURRENT ROW
       ) AS rolling_avg_3
FROM monthly_revenue;`,
    note: 'Frames make moving averages and trailing windows explicit.',
  },
  {
    title: 'Recursive CTE',
    summary: 'Use `WITH RECURSIVE` when a query needs to build rows step by step.',
    syntax: `WITH RECURSIVE date_series(day) AS (
  SELECT date('2026-01-01')
  UNION ALL
  SELECT date(day, '+1 day')
  FROM date_series
  WHERE day < date('2026-01-07')
)
SELECT day
FROM date_series;`,
    note: 'Recursive CTEs are useful for calendars, hierarchies, and sequence generation.',
  },
  {
    title: 'Query Plan',
    summary: 'Use `EXPLAIN QUERY PLAN` to inspect how SQLite intends to run a query.',
    syntax: `EXPLAIN QUERY PLAN
SELECT customer_id, COUNT(*)
FROM orders
GROUP BY customer_id;`,
    note: 'Query plans help you reason about indexes, scans, and the cost of a query shape.',
  },
]

const schemaRelations = [
  {
    from: 'customers',
    to: 'orders',
    fromColumn: 'customer_id',
    toColumn: 'customer_id',
    relationship: '1 customer to many orders',
    note: 'Orders inherit the customer profile and segment from this join path.',
  },
  {
    from: 'customers',
    to: 'web_events',
    fromColumn: 'customer_id',
    toColumn: 'customer_id',
    relationship: '1 customer to many events',
    note: 'Use this path when you need session or funnel behavior by customer.',
  },
  {
    from: 'categories',
    to: 'products',
    fromColumn: 'category_id',
    toColumn: 'category_id',
    relationship: '1 category to many products',
    note: 'This is the main merchandising hierarchy in the catalog.',
  },
  {
    from: 'products',
    to: 'inventory',
    fromColumn: 'product_id',
    toColumn: 'product_id',
    relationship: '1 product to 1 inventory row',
    note: 'Inventory is keyed by product, so the join stays at product grain.',
  },
  {
    from: 'orders',
    to: 'order_items',
    fromColumn: 'order_id',
    toColumn: 'order_id',
    relationship: '1 order to many line items',
    note: 'Use this path for revenue, quantity, and basket analysis.',
  },
  {
    from: 'products',
    to: 'order_items',
    fromColumn: 'product_id',
    toColumn: 'product_id',
    relationship: '1 product to many line items',
    note: 'This is the path for product-level sales analysis.',
  },
  {
    from: 'orders',
    to: 'payments',
    fromColumn: 'order_id',
    toColumn: 'order_id',
    relationship: '1 order to 1 payment record',
    note: 'Use this join when the business question is about paid revenue or payment status.',
  },
  {
    from: 'campaigns',
    to: 'orders',
    fromColumn: 'campaign_id',
    toColumn: 'campaign_id',
    relationship: '1 campaign to many orders',
    note: 'Campaign attribution flows through this optional foreign key.',
  },
  {
    from: 'campaigns',
    to: 'web_events',
    fromColumn: 'campaign_id',
    toColumn: 'campaign_id',
    relationship: '1 campaign to many events',
    note: 'Campaign exposure can be studied at the event level here.',
  },
] as const

const todayKey = () => new Date().toISOString().slice(0, 10)

const isKnownView = (value: unknown): value is View => typeof value === 'string' && value in viewMeta

const pushRecentValue = <T,>(existing: T[] | undefined, value: T, maxItems = 5) => [value, ...(existing ?? [])].slice(0, maxItems)

const reviewIntervals = [1, 3, 7]

const addDays = (dateKey: string, days: number) => {
  const date = new Date(`${dateKey}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

const isDueOnOrBeforeToday = (dateKey: string) => dateKey <= todayKey()

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
  'UNION',
  'ALL',
  'INTERSECT',
  'EXCEPT',
  'IN',
  'BETWEEN',
  'EXISTS',
  'COALESCE',
  'CAST',
  'NULLIF',
  'SUBSTR',
  'LENGTH',
  'REPLACE',
  'DATE',
  'DATETIME',
  'JULIANDAY',
  'RECURSIVE',
  'ROWS',
  'RANGE',
  'PRECEDING',
  'FOLLOWING',
  'CURRENT',
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

const getCasePatternPlaceholder = (challenge: Challenge) => {
  if (challenge.id === 'intermediate-08') {
    return "  product_name,\n  price,\n  CASE\n    WHEN price < cutoff_1 THEN 'Entry'\n    WHEN price < cutoff_2 THEN 'Core'\n    ELSE 'Premium'\n  END AS price_band"
  }

  return '  column_name,\n  CASE\n    WHEN condition_1 THEN result_1\n    WHEN condition_2 THEN result_2\n    ELSE fallback_result\n  END AS label_name'
}

const getBaseSelectPlaceholder = (challenge: Challenge) => {
  const sql = challenge.solutionSql.toUpperCase()

  if (sql.includes('COUNT(')) return '  COUNT(*) AS metric_name'
  if (sql.includes('SUM(')) return '  SUM(numeric_column) AS metric_name'
  if (sql.includes('AVG(')) return '  AVG(numeric_column) AS metric_name'
  if (sql.includes('MIN(') && sql.includes('MAX(')) return '  MIN(column_name) AS min_value,\n  MAX(column_name) AS max_value'
  if (sql.includes('MIN(')) return '  MIN(column_name) AS min_value'
  if (sql.includes('MAX(')) return '  MAX(column_name) AS max_value'
  if (sql.includes('CASE')) return getCasePatternPlaceholder(challenge)
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
    if (challenge.id === 'intermediate-08') {
      lines.push('  product_name,')
      lines.push('  price,')
      lines.push('  CASE')
      lines.push("    WHEN price < -- entry cutoff THEN 'Entry'")
      lines.push("    WHEN price < -- core cutoff THEN 'Core'")
      lines.push("    ELSE 'Premium'")
      lines.push('  END AS price_band')
    } else {
      lines.push('  -- choose the columns you need,')
      lines.push('  CASE')
      lines.push('    WHEN -- condition_1 THEN -- result_1')
      lines.push('    WHEN -- condition_2 THEN -- result_2')
      lines.push('    ELSE -- fallback_result')
      lines.push('  END AS label_name')
    }
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

const getClauseHint = (challenge: Challenge) => {
  const sql = challenge.solutionSql.toUpperCase()

  if (sql.includes('JOIN')) {
    return `You probably need a join between ${challenge.relevantTables.slice(0, 2).join(' and ')}.`
  }
  if (sql.includes('HAVING')) {
    return 'Group first, then use `HAVING` to filter the grouped result.'
  }
  if (sql.includes('GROUP BY')) {
    return 'The non-aggregate columns in the `SELECT` list usually need to appear in `GROUP BY`.'
  }
  if (sql.includes('WHERE')) {
    return 'Put the filter in `WHERE` before the aggregation step.'
  }
  if (sql.includes('ORDER BY') && sql.includes('LIMIT')) {
    return 'Sort first, then limit the rows.'
  }
  if (sql.includes('CASE')) {
    return 'Build the buckets from top to bottom with `CASE WHEN`.'
  }
  if (sql.includes('DISTINCT')) {
    return 'Use `DISTINCT` right after `SELECT` to remove duplicate values.'
  }
  if (sql.includes('OVER (')) {
    return 'Keep the detail rows and add the window function with `OVER`.'
  }

  return 'Translate the business rule into the query clause that changes the result shape.'
}

const getAdaptiveCoachHint = (challenge: Challenge, attemptCount: number) => {
  if (attemptCount <= 0) {
    return null
  }

  if (attemptCount === 1) {
    return `Concept reminder: ${challenge.concept}.`
  }

  if (attemptCount === 2) {
    return `Tables and output: ${challenge.relevantTables.join(', ')}. Return ${challenge.expectedColumns.join(', ')}.`
  }

  if (attemptCount === 3) {
    return `Clause hint: ${getClauseHint(challenge)}`
  }

  if (attemptCount === 4) {
    return `Partial structure:\n${getLearnModePracticeSql(challenge)}`
  }

  return `Worked solution:\n${challenge.solutionSql}`
}

const renderHintBody = (hint: string) =>
  hint.includes('\n') ? <pre>{renderSqlTokens(hint)}</pre> : <span>{renderTextWithInlineCode(hint)}</span>

const formatSqlQuery = (sql: string) => {
  const compact = sql.trim().replace(/;\s*$/, '').replace(/\s+/g, ' ')

  if (!compact) {
    return ''
  }

  const clauseBreaks = [
    'SELECT',
    'FROM',
    'WHERE',
    'GROUP BY',
    'HAVING',
    'ORDER BY',
    'LIMIT',
    'INNER JOIN',
    'LEFT JOIN',
    'RIGHT JOIN',
    'FULL JOIN',
    'JOIN',
    'UNION ALL',
    'UNION',
    'INTERSECT',
    'EXCEPT',
    'WITH',
  ]

  let formatted = compact
  clauseBreaks.forEach((clause) => {
    const clausePattern = new RegExp(`\\s+(${clause.replaceAll(' ', '\\s+')})\\b`, 'gi')
    formatted = formatted.replace(clausePattern, '\n$1')
  })

  formatted = formatted.replace(/\s*,\s*/g, ', ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')')

  return formatted
    .split('\n')
    .map((line, index) => {
      const trimmed = line.trim()
      if (!trimmed) {
        return ''
      }

      if (index === 0 || /^SELECT\b/i.test(trimmed) || /^WITH\b/i.test(trimmed) || /^(UNION ALL|UNION|INTERSECT|EXCEPT)\b/i.test(trimmed)) {
        return trimmed
      }

      if (/^(FROM|WHERE|GROUP BY|HAVING|ORDER BY|LIMIT|JOIN|INNER JOIN|LEFT JOIN|RIGHT JOIN|FULL JOIN)\b/i.test(trimmed)) {
        return trimmed
      }

      if (/^(AND|OR|WHEN|THEN|ELSE|END|ON)\b/i.test(trimmed)) {
        return `  ${trimmed}`
      }

      return `  ${trimmed}`
    })
    .filter(Boolean)
    .join('\n')
    .concat(';')
}

const getEditorSeedSql = (challenge: Challenge, view: View) => {
  if (view === 'learn') {
    return getLearnModePatternSql(challenge)
  }

  if (challenge.mode === 'debug' && challenge.brokenSql) {
    return challenge.brokenSql
  }

  return getLearnModePatternSql(challenge)
}

const getReviewCandidates = (sourceChallenge: Challenge) => {
  const exactConceptMatches = allChallenges.filter(
    (challenge) => challenge.id !== sourceChallenge.id && challenge.concept === sourceChallenge.concept,
  )

  if (exactConceptMatches.length > 0) {
    return exactConceptMatches
  }

  const sameTrackMatches = allChallenges.filter(
    (challenge) => challenge.id !== sourceChallenge.id && challenge.track === sourceChallenge.track,
  )

  if (sameTrackMatches.length > 0) {
    return sameTrackMatches
  }

  return allChallenges.filter((challenge) => challenge.id !== sourceChallenge.id)
}

const getReviewChallenge = (sourceChallenge: Challenge, stage: number, variantSeed: number) => {
  const candidates = getReviewCandidates(sourceChallenge)
  if (candidates.length === 0) {
    return sourceChallenge
  }

  const index = (stage + variantSeed) % candidates.length
  return candidates[index] ?? sourceChallenge
}

const getReviewProgression = (stage: number) => reviewIntervals[Math.min(stage, reviewIntervals.length - 1)]

const createReviewScheduleEntry = (stage = 0, variantSeed = 0) => ({
  stage,
  nextDue: addDays(todayKey(), getReviewProgression(stage)),
  variantSeed,
})

const advanceReviewScheduleEntry = (currentEntry: { stage: number; variantSeed: number } | undefined, succeeded: boolean) => {
  if (!currentEntry) {
    return createReviewScheduleEntry()
  }

  if (succeeded) {
    const nextStage = currentEntry.stage + 1

    if (nextStage >= reviewIntervals.length) {
      return null
    }

    return {
      stage: nextStage,
      nextDue: addDays(todayKey(), reviewIntervals[nextStage]),
      variantSeed: 0,
    }
  }

  return {
    stage: currentEntry.stage,
    nextDue: addDays(todayKey(), reviewIntervals[Math.min(currentEntry.stage, reviewIntervals.length - 1)]),
    variantSeed: currentEntry.variantSeed + 1,
  }
}

const buildInterviewAttemptSummary = (
  challenge: Challenge,
  wasSuccessful: boolean,
  timeLeft: number,
  attempts: number,
  hintsUsed: number,
  expired = false,
): InterviewAttemptSummary => {
  const timeLimit = Math.max(1, challenge.timeLimitSec ?? 180)
  const normalizedTime = Math.max(0, Math.min(1, timeLeft / timeLimit))
  const accuracyScore = wasSuccessful ? 70 : 0
  const speedScore = Math.round(normalizedTime * 20)
  const disciplinePenalty = Math.min(10, Math.max(0, attempts - 1) * 2 + hintsUsed * 2)
  const disciplineScore = Math.max(0, 10 - disciplinePenalty)
  const score = Math.max(0, Math.min(100, accuracyScore + speedScore + disciplineScore))

  return {
    status: expired ? 'expired' : wasSuccessful ? 'success' : 'failed',
    score,
    accuracyScore,
    speedScore,
    disciplineScore,
    attempts,
    hintsUsed,
    timeLeft,
  }
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
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [lessonTab, setLessonTab] = useState<(typeof lessonTabs)[number]['id']>('concept')
  const [workspaceTab, setWorkspaceTab] = useState<(typeof workspaceTabs)[number]['id']>('results')
  const [showFullMasteryReport, setShowFullMasteryReport] = useState(false)
  const [activeReviewSourceId, setActiveReviewSourceId] = useState<string | null>(null)
  const [progressReady, setProgressReady] = useState(false)
  const [schemaOverview, setSchemaOverview] = useState<{ counts: Record<string, number>; samples: Record<string, QueryResult> } | null>(null)
  const [syntaxSearch, setSyntaxSearch] = useState('')
  const [queryExplanation, setQueryExplanation] = useState<string[] | null>(null)
  const [interviewAttemptSummary, setInterviewAttemptSummary] = useState<InterviewAttemptSummary | null>(null)
  const [interviewExpiredChallengeId, setInterviewExpiredChallengeId] = useState<string | null>(null)
  const [editorScrollTop, setEditorScrollTop] = useState(0)
  const hasLoadedProgress = useRef(false)
  const draftStoreRef = useRef(progress.editorDrafts)
  const hintStoreRef = useRef(progress.hintSteps)

  useEffect(() => {
    let cancelled = false

    const initializeProgress = async () => {
      const savedProgress = await loadProgress()
      if (!cancelled) {
        setProgress(savedProgress)
        if (savedProgress.lastView && isKnownView(savedProgress.lastView)) {
          setView(savedProgress.lastView)
        }
        if (savedProgress.selectedChallengeId) {
          setSelectedChallengeId(savedProgress.selectedChallengeId)
        }
        if (savedProgress.reviewSchedule) {
          // No-op; the schedule is restored through progress and normalized on load.
        }
        hasLoadedProgress.current = true
        setProgressReady(true)
      }
    }

    void initializeProgress()
    getDatabaseSnapshot().then(setDatabasePreview).catch(() => undefined)
    getSchemaOverview().then(setSchemaOverview).catch(() => undefined)
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

  useEffect(() => {
    draftStoreRef.current = progress.editorDrafts
  }, [progress.editorDrafts])

  useEffect(() => {
    hintStoreRef.current = progress.hintSteps
  }, [progress.hintSteps])

  useEffect(() => {
    if (!progressReady) {
      return
    }

    setProgress((current) =>
      current.lastView === view
        ? current
        : {
            ...current,
            lastView: view,
          },
    )
  }, [progressReady, view])

  useEffect(() => {
    if (!progressReady) {
      return
    }

    setProgress((current) =>
      current.selectedChallengeId === selectedChallengeId
        ? current
        : {
            ...current,
            selectedChallengeId,
          },
    )
  }, [progressReady, selectedChallengeId])

  useEffect(() => {
    if (!progressReady) {
      return
    }

    const missingSchedules = progress.incorrectIds.filter((challengeId) => !progress.reviewSchedule[challengeId])
    if (missingSchedules.length === 0) {
      return
    }

    setProgress((current) => {
      const nextSchedule = { ...current.reviewSchedule }

      missingSchedules.forEach((challengeId) => {
        nextSchedule[challengeId] = createReviewScheduleEntry()
      })

      return {
        ...current,
        reviewSchedule: nextSchedule,
      }
    })
  }, [progress.incorrectIds, progress.reviewSchedule, progressReady])

  useEffect(() => {
    if (view !== 'review') {
      setActiveReviewSourceId(null)
    }
  }, [view])

  useEffect(() => {
    setMobileNavOpen(false)
  }, [view, selectedChallengeId])

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

  const reviewQueue = useMemo(() => {
    return Object.entries(progress.reviewSchedule)
      .map(([sourceChallengeId, entry]) => {
        const sourceChallenge = allChallenges.find((challenge) => challenge.id === sourceChallengeId)

        if (!sourceChallenge) {
          return null
        }

        return {
          sourceChallengeId,
          sourceChallenge,
          reviewChallenge: getReviewChallenge(sourceChallenge, entry.stage, entry.variantSeed),
          stage: entry.stage,
          nextDue: entry.nextDue,
          variantSeed: entry.variantSeed,
          due: isDueOnOrBeforeToday(entry.nextDue),
        }
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
      .sort(
        (left, right) =>
          left.nextDue.localeCompare(right.nextDue) ||
          left.stage - right.stage ||
          left.sourceChallenge.title.localeCompare(right.sourceChallenge.title),
      )
  }, [progress.reviewSchedule])

  const dueReviewQueue = useMemo(() => reviewQueue.filter((entry) => entry.due), [reviewQueue])

  const currentChallenge = useMemo(() => {
    if (view === 'practice') {
      return practiceChallenge
    }

    if (view === 'review') {
      if (activeReviewSourceId) {
        const activeEntry = reviewQueue.find((entry) => entry.sourceChallengeId === activeReviewSourceId)
        if (activeEntry) {
          return activeEntry.reviewChallenge
        }
      }

      return dueReviewQueue[0]?.reviewChallenge ?? reviewQueue[0]?.reviewChallenge ?? null
    }

    return allChallenges.find((challenge) => challenge.id === selectedChallengeId) ?? lessonsByTrack.beginner[0]
  }, [activeReviewSourceId, dueReviewQueue, practiceChallenge, reviewQueue, selectedChallengeId, view])

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
  const currentLearnLessonPosition = currentLearnChallengeIndex >= 0 ? currentLearnChallengeIndex + 1 : null
  const currentAttemptCount = useMemo(
    () => (currentChallenge ? progress.queryHistory[currentChallenge.id]?.length ?? 0 : 0),
    [currentChallenge, progress.queryHistory],
  )
  const editorLineCount = useMemo(() => Math.max(1, editorSql.split('\n').length), [editorSql])
  const conceptMastery = useMemo(() => {
    const grouped = new Map<
      string,
      { total: number; completed: number; firstTry: number; retries: number; hints: number }
    >()

    allChallenges.forEach((challenge) => {
      const current = grouped.get(challenge.concept) ?? {
        total: 0,
        completed: 0,
        firstTry: 0,
        retries: 0,
        hints: 0,
      }

      const attempts = progress.queryHistory[challenge.id]?.length ?? 0
      const hints = progress.hintSteps[challenge.id] ?? 0
      const completed = progress.completedIds.includes(challenge.id)

      current.total += 1
      current.hints += hints
      current.retries += Math.max(0, attempts - 1)
      if (completed) {
        current.completed += 1
        if (attempts <= 1) {
          current.firstTry += 1
        }
      }

      grouped.set(challenge.concept, current)
    })

    return [...grouped.entries()]
      .map(([concept, stats]) => {
        const completionRate = stats.completed / Math.max(1, stats.total)
        const firstTryRate = stats.firstTry / Math.max(1, stats.completed)
        const retryPenalty = Math.min(12, stats.retries * 2)
        const hintPenalty = Math.min(12, stats.hints * 2)
        const score = Math.max(
          0,
          Math.min(100, Math.round(completionRate * 55 + firstTryRate * 25 + 20 - retryPenalty - hintPenalty)),
        )

        return {
          concept,
          score,
          ...stats,
        }
      })
      .sort((left, right) => right.score - left.score || right.completed - left.completed || left.concept.localeCompare(right.concept))
  }, [progress.completedIds, progress.hintSteps, progress.queryHistory])
  const weakestConcepts = useMemo(() => conceptMastery.slice(-3).reverse(), [conceptMastery])
  const filteredSyntaxReference = useMemo(() => {
    const term = syntaxSearch.trim().toLowerCase()
    if (!term) {
      return syntaxReference
    }

    return syntaxReference.filter((entry) =>
      [entry.title, entry.summary, entry.note, entry.syntax].some((field) => field.toLowerCase().includes(term)),
    )
  }, [syntaxSearch])
  const queryExplanationLines = queryExplanation ?? []
  const followUpPrompt = currentChallenge ? getFollowUpPrompt(currentChallenge) : null
  const interviewIsExpired = view === 'interview' && interviewSecondsLeft !== null && interviewSecondsLeft <= 0
  const nextLearnChallenge = useMemo(
    () =>
      currentLearnChallengeIndex >= 0 && currentLearnChallengeIndex < learnChallenges.length - 1
        ? learnChallenges[currentLearnChallengeIndex + 1]
        : null,
    [currentLearnChallengeIndex],
  )

  useEffect(() => {
    if (view === 'learn') {
      setLessonTab('concept')
    }
  }, [currentChallenge?.id, view])

  useEffect(() => {
    setWorkspaceTab('results')
  }, [currentChallenge?.id, view])

  useEffect(() => {
    if (!currentChallenge) {
      return
    }

    const savedDraft = progressReady ? draftStoreRef.current[currentChallenge.id] : undefined
    const savedHintStep = progressReady ? hintStoreRef.current[currentChallenge.id] : undefined

    setEditorSql(savedDraft ?? getEditorSeedSql(currentChallenge, view))
    setHintStep(savedHintStep ?? 0)
    setFeedback({
      status: 'idle',
      title: currentChallenge.title,
      message: currentChallenge.task,
    })
    setQueryResult(null)
    setQueryExplanation(null)
    setInterviewAttemptSummary(null)
    setInterviewExpiredChallengeId(null)

    if (view === 'interview' && currentChallenge.timeLimitSec) {
      setInterviewSecondsLeft(currentChallenge.timeLimitSec)
    } else {
      setInterviewSecondsLeft(null)
    }
  }, [currentChallenge, progressReady, view])

  useEffect(() => {
    if (view !== 'interview' || interviewSecondsLeft === null || interviewSecondsLeft <= 0) {
      return
    }

    const timer = window.setTimeout(() => {
      setInterviewSecondsLeft((seconds) => (seconds === null ? seconds : seconds - 1))
    }, 1000)

    return () => window.clearTimeout(timer)
  }, [interviewSecondsLeft, view])

  const markChallengeResult = useCallback((
    challenge: Challenge,
    wasSuccessful: boolean,
    reviewSourceId?: string,
    interviewScore?: number,
  ) => {
    setProgress((current) => {
      const scheduleKey = reviewSourceId ?? challenge.id
      const currentScheduleEntry = current.reviewSchedule[scheduleKey]
      let reviewSchedule = current.reviewSchedule

      if (wasSuccessful && reviewSourceId && currentScheduleEntry) {
        const nextSchedule = advanceReviewScheduleEntry(currentScheduleEntry, true)
        if (nextSchedule === null) {
          reviewSchedule = Object.fromEntries(Object.entries(current.reviewSchedule).filter(([id]) => id !== scheduleKey))
        } else {
          reviewSchedule = {
            ...current.reviewSchedule,
            [scheduleKey]: nextSchedule,
          }
        }
      } else if (!wasSuccessful) {
        const nextSchedule = advanceReviewScheduleEntry(currentScheduleEntry, false) ?? createReviewScheduleEntry()
        reviewSchedule = {
          ...current.reviewSchedule,
          [scheduleKey]: nextSchedule,
        }
      }

      const completedIds = wasSuccessful
        ? Array.from(new Set([...current.completedIds, challenge.id]))
        : current.completedIds

      const incorrectIds = wasSuccessful
        ? current.incorrectIds.filter((id) => id !== scheduleKey && id !== challenge.id)
        : Array.from(new Set([...current.incorrectIds, scheduleKey]))

      const alreadyCompleted = current.completedIds.includes(challenge.id)
      const xp = wasSuccessful && !alreadyCompleted ? current.xp + challenge.xpReward : current.xp
      const streak =
        wasSuccessful && current.lastActiveDate !== todayKey()
          ? current.streak + 1
          : wasSuccessful
            ? current.streak
            : current.streak

      const bestInterviewScore =
        challenge.mode === 'interview'
          ? Math.max(
              current.bestInterviewScore,
              interviewScore ??
                Math.max(0, Math.min(100, Math.round(((interviewSecondsLeft ?? 0) / (challenge.timeLimitSec ?? 1)) * 100))),
            )
          : current.bestInterviewScore

      const completed = allChallenges.filter((candidate) => completedIds.includes(candidate.id))

      return {
        ...current,
        completedIds,
        xp,
        streak,
        incorrectIds,
        bestInterviewScore,
        lastActiveDate: wasSuccessful ? todayKey() : current.lastActiveDate,
        badges: deriveBadges(completed, bestInterviewScore),
        reviewSchedule,
      }
    })
  }, [interviewSecondsLeft])

  useEffect(() => {
    if (view !== 'interview' || !currentChallenge || currentChallenge.mode !== 'interview') {
      return
    }

    if (interviewSecondsLeft !== 0 || interviewExpiredChallengeId === currentChallenge.id) {
      return
    }

    const summary = buildInterviewAttemptSummary(
      currentChallenge,
      false,
      0,
      currentAttemptCount + 1,
      hintStep,
      true,
    )

    setInterviewExpiredChallengeId(currentChallenge.id)
    setInterviewAttemptSummary(summary)
    setFeedback({
      status: 'error',
      title: 'Time expired',
      message: 'The timer reached zero before you submitted a final query.',
      detail: `Interview score: ${summary.score}/100. Try again with a cleaner plan and fewer hints.`,
    })
    markChallengeResult(currentChallenge, false, activeReviewSourceId ?? undefined, summary.score)
  }, [
    activeReviewSourceId,
    currentChallenge,
    currentAttemptCount,
    hintStep,
    interviewExpiredChallengeId,
    interviewSecondsLeft,
    markChallengeResult,
    view,
  ])

  const handleRun = async () => {
    if (!currentChallenge) {
      return
    }

    if (view === 'interview' && interviewSecondsLeft !== null && interviewSecondsLeft <= 0) {
      setFeedback({
        status: 'error',
        title: 'Time expired',
        message: 'The timer reached zero, so this interview attempt is closed.',
        detail: 'Open a new attempt and work faster on the next pass.',
      })
      return
    }

    setIsRunning(true)
    try {
      if (progressReady) {
        setProgress((current) => ({
          ...current,
          queryHistory: {
            ...(current.queryHistory ?? {}),
            [currentChallenge.id]: pushRecentValue(current.queryHistory?.[currentChallenge.id], editorSql.trim()),
          },
        }))
      }

      const userResult = await runSql(editorSql)
      setQueryResult(userResult)

      const expectedResult = await runSql(currentChallenge.solutionSql)
      const validation = compareResults(currentChallenge, editorSql, userResult, expectedResult)
      setFeedback(validation)
      const interviewSummary =
        view === 'interview'
          ? buildInterviewAttemptSummary(
              currentChallenge,
              validation.status === 'success',
              Math.max(0, interviewSecondsLeft ?? 0),
              currentAttemptCount + 1,
              hintStep,
            )
          : null

      if (interviewSummary) {
        setInterviewAttemptSummary(interviewSummary)
      }

      markChallengeResult(
        currentChallenge,
        validation.status === 'success',
        activeReviewSourceId ?? undefined,
        interviewSummary?.score,
      )

      if (validation.status === 'error') {
        setHintStep((step) => Math.max(step, Math.min(currentChallenge.hints.length, currentAttemptCount + 1)))
      }
    } catch (error) {
      setFeedback(syntaxFeedback(error))
      if (view === 'interview') {
        const interviewSummary = buildInterviewAttemptSummary(
          currentChallenge,
          false,
          Math.max(0, interviewSecondsLeft ?? 0),
          currentAttemptCount + 1,
          hintStep,
        )
        setInterviewAttemptSummary(interviewSummary)
        markChallengeResult(currentChallenge, false, activeReviewSourceId ?? undefined, interviewSummary.score)
      } else {
        markChallengeResult(currentChallenge, false)
      }
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

  const handleEditorChange = (value: string) => {
    setEditorSql(value)
    setQueryExplanation(null)

    if (!currentChallenge || !progressReady) {
      return
    }

    setProgress((current) => ({
      ...current,
      editorDrafts: {
        ...(current.editorDrafts ?? {}),
        [currentChallenge.id]: value,
      },
    }))
  }

  const handleFormatSql = () => {
    handleEditorChange(formatSqlQuery(editorSql))
  }

  const handleEditorScroll = (event: React.UIEvent<HTMLTextAreaElement>) => {
    setEditorScrollTop(event.currentTarget.scrollTop)
  }

  const selectChallenge = (challenge: Challenge) => {
    setSelectedChallengeId(challenge.id)
    setActiveReviewSourceId(null)
    setTaskMenuCollapsed(true)
    if (view === 'practice') {
      setView('learn')
    }
  }

  const selectReviewChallenge = (sourceChallengeId: string) => {
    const entry = reviewQueue.find((item) => item.sourceChallengeId === sourceChallengeId)
    if (!entry) {
      return
    }

    setActiveReviewSourceId(sourceChallengeId)
    setSelectedChallengeId(entry.reviewChallenge.id)
    setView('review')
    setTaskMenuCollapsed(true)
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

  const learnTheory = useMemo(
    () => (view === 'learn' && currentChallenge ? getLearnModeTheory(currentChallenge) : null),
    [currentChallenge, view],
  )

  function getFollowUpPrompt(challenge: Challenge) {
    if (challenge.followUp) {
      return challenge.followUp
    }

    const sql = challenge.solutionSql.toUpperCase()

    if (sql.includes('JOIN')) {
      return 'Try the same join with a different table pair or a different join key.'
    }

    if (sql.includes('GROUP BY')) {
      return 'Change the grouping column or threshold and see which rows move.'
    }

    if (sql.includes('CASE')) {
      return 'Adjust one bucket cutoff and check whether the labels still make sense.'
    }

    if (sql.includes('WHERE')) {
      return 'Swap the filter value for a different segment and compare the output.'
    }

    if (sql.includes('OVER (')) {
      return 'Try partitioning or ordering the window function differently.'
    }

    return 'Change one piece of the query and observe how the result changes.'
  }

  const explainQuery = (sql: string) => {
    const trimmed = sql.trim()

    if (!trimmed) {
      return ['Type or paste a query first, then ask for an explanation.']
    }

    const normalized = trimmed.replace(/\s+/g, ' ')
    const upper = normalized.toUpperCase()
    const lines: string[] = []
    let step = 1
    const sources = Array.from(
      new Set([
        ...(normalized.match(/\bFROM\s+([a-zA-Z_][a-zA-Z0-9_]*)/gi) ?? []).map((match) => match.replace(/\bFROM\s+/i, '').trim()),
        ...((normalized.match(/\bJOIN\s+([a-zA-Z_][a-zA-Z0-9_]*)/gi) ?? []).map((match) => match.replace(/\bJOIN\s+/i, '').trim())),
      ]),
    )

    if (upper.startsWith('WITH ')) {
      lines.push(`${step}. Build the common table expression(s) first, then use the final SELECT on top of them.`)
      step += 1
    }

    if (sources.length > 0) {
      lines.push(`${step}. Read rows from: ${sources.join(', ')}.`)
    } else {
      lines.push(`${step}. Read rows from the source table(s) named in the FROM clause.`)
    }
    step += 1

    if (upper.includes('JOIN')) {
      lines.push(`${step}. Join related tables before the filter or aggregation step finishes.`)
      step += 1
    }

    if (upper.includes('WHERE')) {
      lines.push(`${step}. Filter the raw rows with WHERE so only qualifying records continue.`)
      step += 1
    }

    if (upper.includes('GROUP BY')) {
      lines.push(`${step}. Collapse rows to the grouping grain before computing aggregates.`)
      step += 1
    }

    if (upper.includes('HAVING')) {
      lines.push(`${step}. Remove grouped results that do not meet the aggregate rule.`)
      step += 1
    }

    if (upper.includes('CASE')) {
      lines.push(`${step}. Use CASE to label or bucket each row after the needed columns are available.`)
      step += 1
    }

    if (upper.includes('OVER (')) {
      lines.push(`${step}. Evaluate the window function across the ordered or partitioned row set.`)
      step += 1
    }

    if (upper.includes('ORDER BY')) {
      lines.push(`${step}. Sort the final rows before the result is shown.`)
      step += 1
    }

    if (upper.includes('LIMIT')) {
      lines.push(`${step}. Keep only the first N rows after sorting.`)
    }

    return lines.length > 0 ? lines : ['This query is very short, so the explanation is mostly about the SELECT list and source table.']
  }

  const handleExplainQuery = () => {
    setQueryExplanation(explainQuery(editorSql))
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

  const renderReviewChallengeList = (items: typeof reviewQueue) => (
    <div className="challenge-list">
      {items.map((item) => {
        const active = activeReviewSourceId === item.sourceChallengeId

        return (
          <button
            key={`${item.sourceChallengeId}-${item.stage}-${item.variantSeed}`}
            type="button"
            className={`challenge-card ${active ? 'active' : ''}`}
            onClick={() => selectReviewChallenge(item.sourceChallengeId)}
          >
            <div className="challenge-topline">
              <span>{item.reviewChallenge.title}</span>
              <ShieldCheck size={16} />
            </div>
            <p>{item.sourceChallenge.concept}</p>
            <div className="challenge-meta">
              <span>
                Stage {item.stage + 1}/3 {item.due ? 'due now' : `due ${item.nextDue}`}
              </span>
              <span>{item.reviewChallenge.xpReward} XP</span>
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
        return reviewQueue.length > 0 ? (
          <>
            <section className="mode-section">
              <div className="section-heading">
                <h3>Due now</h3>
                <span>{dueReviewQueue.length} scheduled reviews</span>
              </div>
              {renderReviewChallengeList(dueReviewQueue.length > 0 ? dueReviewQueue : reviewQueue)}
            </section>
          </>
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
      <header className="mobile-shell">
        <button type="button" className="brand-button" onClick={() => setView('dashboard')} aria-label="Go to dashboard">
          <div className="brand-mark">SQL</div>
          <div className="brand-copy">
            <strong>Analyst Quest</strong>
            <span>{viewMeta[view].label}</span>
          </div>
        </button>
        <div className="mobile-shell-meta">
          <span className="mobile-pill">{progress.xp} XP</span>
          <span className="mobile-pill">{progress.streak} day streak</span>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label={mobileNavOpen ? 'Close navigation' : 'Open navigation'}
          aria-expanded={mobileNavOpen}
          aria-controls="mobile-nav-drawer"
          onClick={() => setMobileNavOpen((current) => !current)}
        >
          {mobileNavOpen ? <X size={18} /> : <Menu size={18} />}
        </button>
      </header>

      <div className={`mobile-scrim ${mobileNavOpen ? 'open' : ''}`} onClick={() => setMobileNavOpen(false)} />

      <aside className={`mobile-drawer ${mobileNavOpen ? 'open' : ''}`} id="mobile-nav-drawer" aria-label="Navigation drawer">
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

        <nav className="nav-groups" aria-label="Primary navigation">
          {navGroups.map((group) => (
            <section key={group.label} className="nav-group">
              <span className="nav-group-label">{group.label}</span>
              <div className="nav-list">
                {group.views.map((viewKey) => {
                  const meta = viewMeta[viewKey]
                  const Icon = meta.icon

                  return (
                    <button
                      key={viewKey}
                      type="button"
                      className={`nav-button ${view === viewKey ? 'active' : ''}`}
                      aria-current={view === viewKey ? 'page' : undefined}
                      onClick={() => {
                        setView(viewKey)
                        setMobileNavOpen(false)
                      }}
                    >
                      <Icon size={18} />
                      <span>{meta.label}</span>
                    </button>
                  )
                })}
              </div>
            </section>
          ))}
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

        <nav className="nav-groups" aria-label="Primary navigation">
          {navGroups.map((group) => (
            <section key={group.label} className="nav-group">
              <span className="nav-group-label">{group.label}</span>
              <div className="nav-list">
                {group.views.map((viewKey) => {
                  const meta = viewMeta[viewKey]
                  const Icon = meta.icon

                  return (
                    <button
                      key={viewKey}
                      type="button"
                      className={`nav-button ${view === viewKey ? 'active' : ''}`}
                      aria-current={view === viewKey ? 'page' : undefined}
                      onClick={() => setView(viewKey)}
                    >
                      <Icon size={18} />
                      <span>{meta.label}</span>
                    </button>
                  )
                })}
              </div>
            </section>
          ))}
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
            <div className="dashboard-hero">
              <section className="panel continue-panel">
                <div className="section-heading">
                  <h3>Continue learning</h3>
                  <span>{completionPct}% complete</span>
                </div>
                {nextChallenge ? (
                  <>
                    <div className="continue-copy">
                      <h2>{nextChallenge.title}</h2>
                      <p>{nextChallenge.task}</p>
                    </div>
                    <div className="continue-meta">
                      <span>{nextChallenge.mode}</span>
                      <span>{nextChallenge.concept}</span>
                      <span>{nextChallenge.difficulty}</span>
                    </div>
                    <button
                      type="button"
                      className="primary-button"
                      onClick={() => {
                        setView(nextChallenge.mode === 'career' ? 'career' : nextChallenge.mode === 'interview' ? 'interview' : nextChallenge.mode === 'debug' ? 'debug' : 'learn')
                        setSelectedChallengeId(nextChallenge.id)
                      }}
                    >
                      Open challenge
                    </button>
                  </>
                ) : (
                  <div className="empty-state">You have cleared the full path. Use Practice Mode to keep sharpening.</div>
                )}
              </section>

              <div className="dashboard-metrics">
                <article className="metric-card">
                  <span>Completed</span>
                  <strong>{completedChallenges.length}</strong>
                  <small>of {allChallenges.length} total challenges</small>
                </article>
                <article className="metric-card">
                  <span>Badges</span>
                  <strong>{progress.badges.length}</strong>
                  <small>earned through milestones</small>
                </article>
                <article className="metric-card">
                  <span>Interview best</span>
                  <strong>{progress.bestInterviewScore}</strong>
                  <small>score out of 100</small>
                </article>
                <article className="metric-card">
                  <span>Rank</span>
                  <strong>{rank.current.label}</strong>
                  <small>{rank.next ? `Next: ${rank.next.label}` : 'Max rank reached'}</small>
                </article>
              </div>
            </div>

            <div className="dashboard-columns">
              <section className="panel dashboard-path-panel">
                <div className="section-heading">
                  <h3>Learning path</h3>
                  <span>Structured progression</span>
                </div>
                <div className="path-track">
                  {rankSteps.map((step, index) => (
                    <div key={step.label} className={`path-step ${progress.xp >= step.minXp ? 'reached' : ''}`}>
                      <strong>{index + 1}</strong>
                      <span>{step.label}</span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="dashboard-side-stack">
                <section className="panel">
                  <div className="section-heading">
                    <h3>Weakest concepts</h3>
                    <button type="button" className="text-button" onClick={() => setShowFullMasteryReport((current) => !current)}>
                      {showFullMasteryReport ? 'Hide full report' : 'Full report'}
                    </button>
                  </div>
                  <div className="mastery-grid">
                    {weakestConcepts.length > 0 ? (
                      weakestConcepts.map((entry) => (
                        <article key={entry.concept} className="mastery-card">
                          <div className="mastery-header">
                            <strong>{entry.concept}</strong>
                            <span>{entry.score}%</span>
                          </div>
                          <div className="progress-bar">
                            <span style={{ width: `${entry.score}%` }} />
                          </div>
                          <small>
                            {entry.completed}/{entry.total} complete · {entry.retries} retries · {entry.hints} hints
                          </small>
                        </article>
                      ))
                    ) : (
                      <div className="empty-state">Mastery data will appear after your first completed lesson.</div>
                    )}
                    {showFullMasteryReport ? (
                      <div className="mastery-report">
                        {conceptMastery.map((entry) => (
                          <div key={entry.concept} className="mastery-report-row">
                            <span>{entry.concept}</span>
                            <strong>{entry.score}%</strong>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
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
                    <h3>Schema overview</h3>
                    <span>Compact reference</span>
                  </div>
                  <div className="schema-preview-grid compact">
                    {schemaTables.slice(0, 3).map((table) => (
                      <div key={table.name} className="schema-preview-card">
                        <strong>{table.name}</strong>
                        <p>{table.description}</p>
                        <small>{table.columns.length} columns</small>
                      </div>
                    ))}
                  </div>
                </section>
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
              <div className="relationship-map">
                {schemaRelations.map((relation) => {
                  const leftCount = schemaOverview?.counts[relation.from]
                  const rightCount = schemaOverview?.counts[relation.to]

                  return (
                    <article key={`${relation.from}-${relation.to}-${relation.fromColumn}-${relation.toColumn}`} className="relationship-card">
                      <div className="relationship-path">
                        <strong>{relation.from}</strong>
                        <ArrowRight size={14} />
                        <strong>{relation.to}</strong>
                      </div>
                      <p>{relation.note}</p>
                      <small>
                        {relation.fromColumn} → {relation.toColumn}
                      </small>
                      <div className="relationship-meta">
                        <span>{relation.relationship}</span>
                        <span>
                          {typeof leftCount === 'number' ? `${leftCount} rows` : 'Loading'} ·{' '}
                          {typeof rightCount === 'number' ? `${rightCount} rows` : 'Loading'}
                        </span>
                      </div>
                    </article>
                  )
                })}
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
        ) : view === 'syntax' ? (
          <section className="syntax-layout">
            <div className="hero-panel">
              <div>
                <span className="eyebrow">Reference</span>
                <h2>SQL syntax patterns you can check while learning.</h2>
                <p>
                  This guide keeps the core query shapes inside the app so you can review syntax quickly without leaving your lesson.
                </p>
              </div>
              <div className="hero-grid">
                <div className="metric-card">
                  <span>Patterns</span>
                  <strong>{syntaxReference.length}</strong>
                  <small>common SQL building blocks</small>
                </div>
                <div className="metric-card">
                  <span>Focus</span>
                  <strong>SQLite</strong>
                  <small>same syntax used by the lessons</small>
                </div>
                <div className="metric-card">
                  <span>Best use</span>
                  <strong>Quick lookup</strong>
                  <small>read the shape, then return to practice</small>
                </div>
              </div>
            </div>

            <div className="panel syntax-search-panel">
              <div className="section-heading">
                <h3>Search syntax</h3>
                <span>Filter the guide by clause, function, or keyword</span>
              </div>
              <div className="syntax-search-bar">
                <label>
                  Search
                  <input
                    type="search"
                    value={syntaxSearch}
                    onChange={(event) => setSyntaxSearch(event.target.value)}
                    placeholder="Try join, window, null, range, or date"
                  />
                </label>
                <button type="button" className="secondary-button" onClick={() => setSyntaxSearch('')}>
                  Clear
                </button>
              </div>
            </div>

            <div className="syntax-grid">
              {filteredSyntaxReference.map((entry) => (
                <article key={entry.title} className="panel syntax-card">
                  <div className="section-heading">
                    <h3>{entry.title}</h3>
                    <span>{entry.summary}</span>
                  </div>
                  <div className="example-code">
                    <pre>{renderSqlTokens(entry.syntax)}</pre>
                  </div>
                  <p className="syntax-note">{renderTextWithInlineCode(entry.note)}</p>
                </article>
              ))}
              {filteredSyntaxReference.length === 0 ? (
                <div className="panel empty-state syntax-empty-state">
                  No syntax patterns matched that search. Try `join`, `window`, `date`, or `null`.
                </div>
              ) : null}
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
                    {view === 'learn' && currentLearnLessonPosition ? (
                      <span className="workspace-step">
                        Lesson {currentLearnLessonPosition} of {learnChallenges.length}
                      </span>
                    ) : null}
                  </div>

                  {view === 'learn' && learnTheory ? (
                    <section className="learn-workspace">
                      <article className="panel lesson-panel">
                        <div className="detail-header lesson-header">
                          <div>
                            <span className="eyebrow">Lesson first</span>
                            <h3>{currentChallenge.title}</h3>
                            <p className="context">{currentChallenge.businessContext}</p>
                          </div>
                          <div className="lesson-header-meta">
                            <div className="lesson-chip">
                              <BookOpen size={16} />
                              <span>{currentChallenge.concept}</span>
                            </div>
                            <div className="lesson-progress">
                              <span>{currentLearnLessonPosition}</span>
                              <small>of {learnChallenges.length}</small>
                            </div>
                          </div>
                        </div>

                        <div className="lesson-tabs" role="tablist" aria-label="Lesson sections">
                          {lessonTabs.map((tab) => (
                            <button
                              key={tab.id}
                              type="button"
                              role="tab"
                              aria-selected={lessonTab === tab.id}
                              className={`tab-button ${lessonTab === tab.id ? 'active' : ''}`}
                              onClick={() => setLessonTab(tab.id)}
                            >
                              {tab.label}
                            </button>
                          ))}
                        </div>

                        <div className="lesson-brief">
                          <strong>Your practice task</strong>
                          <p>{renderTextWithInlineCode(currentChallenge.task)}</p>
                          <div className="lesson-brief-grid">
                            <div>
                              <span>Tables</span>
                              <strong>{renderTextWithInlineCode(currentChallenge.relevantTables.join(', '))}</strong>
                            </div>
                            <div>
                              <span>Expected shape</span>
                              <strong>{renderTextWithInlineCode(currentChallenge.expectedColumns.join(', '))}</strong>
                            </div>
                            <div>
                              <span>Watch out for</span>
                              <strong>{renderTextWithInlineCode(currentChallenge.commonMistake)}</strong>
                            </div>
                          </div>
                        </div>

                        <div className="lesson-tab-panel">
                          {lessonTab === 'concept' ? (
                            <div className="lesson-copy">
                              <div>
                                <span>What you are learning</span>
                                <p>{renderTextWithInlineCode(learnTheory.learningGoal)}</p>
                              </div>
                              <div>
                                <span>The idea behind it</span>
                                <p>{renderTextWithInlineCode(learnTheory.theory)}</p>
                              </div>
                              <div>
                                <span>The SQL pattern</span>
                                <p>{renderTextWithInlineCode(learnTheory.pattern)}</p>
                              </div>
                              <div>
                                <span>Key takeaway</span>
                                <p>{renderTextWithInlineCode(learnTheory.keyTakeaway)}</p>
                              </div>
                            </div>
                          ) : null}

                          {lessonTab === 'example' ? (
                            <div className="lesson-example-stack">
                              <div className="section-heading">
                                <h4>Example pattern</h4>
                                <span>Study the structure, then solve the task with your own query</span>
                              </div>
                              <div className="example-code">
                                <pre>{renderSqlTokens(learnTheory.exampleQuery)}</pre>
                              </div>
                              <div className="lesson-copy compact">
                                <div>
                                  <span>Walkthrough</span>
                                  <p>{renderTextWithInlineCode(learnTheory.mentalModel)}</p>
                                </div>
                                <div>
                                  <span>Why analysts use it</span>
                                  <p>{renderTextWithInlineCode(currentChallenge.analystUseCase)}</p>
                                </div>
                              </div>
                            </div>
                          ) : null}

                          {lessonTab === 'task' ? (
                            <div className="lesson-copy">
                              <div>
                                <span>Business context</span>
                                <p>{renderTextWithInlineCode(currentChallenge.businessContext)}</p>
                              </div>
                              <div>
                                <span>How to think about it</span>
                                <p>{renderTextWithInlineCode(currentChallenge.explanation)}</p>
                              </div>
                              <div>
                                <span>Follow-up variation</span>
                                <p>{renderTextWithInlineCode(followUpPrompt ?? 'Change one piece of the query and observe how the result changes.')}</p>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </article>

                      <div className="learn-right-rail">
                        <article className="panel editor-panel">
                          <div className="editor-toolbar">
                            <div className="toolbar-title">
                              <Database size={16} />
                              <span>Your turn</span>
                            </div>
                            <div className="toolbar-actions">
                              <button type="button" className="secondary-button" onClick={handleExplainQuery}>
                                <Search size={16} />
                                <span>Explain</span>
                              </button>
                              <button
                                type="button"
                                className="secondary-button"
                                onClick={() => handleEditorChange(getLearnModePracticeSql(currentChallenge))}
                              >
                                <BookOpen size={16} />
                                <span>Scaffold</span>
                              </button>
                              <button
                                type="button"
                                className="secondary-button"
                                onClick={() => handleEditorChange(getEditorSeedSql(currentChallenge, view))}
                              >
                                <RefreshCw size={16} />
                                <span>Reset</span>
                              </button>
                              <button type="button" className="secondary-button" onClick={handleFormatSql}>
                                <Sparkles size={16} />
                                <span>Format</span>
                              </button>
                              <button type="button" className="primary-button" onClick={handleRun} disabled={isRunning || interviewIsExpired}>
                                <Play size={16} />
                                <span>{isRunning ? 'Running…' : interviewIsExpired ? 'Time Expired' : 'Run Query'}</span>
                              </button>
                            </div>
                          </div>
                          <p className="editor-intro">
                            Start with the pattern, then write the query that solves the task in your own words.
                          </p>
                          <div className="code-editor-shell">
                            <div className="code-editor-gutter" aria-hidden="true">
                              <div className="code-editor-gutter-scroll" style={{ transform: `translateY(-${editorScrollTop}px)` }}>
                                {Array.from({ length: editorLineCount }, (_, index) => (
                                  <span key={index}>{index + 1}</span>
                                ))}
                              </div>
                            </div>
                            <textarea
                              aria-label="SQL practice editor"
                              value={editorSql}
                              onChange={(event) => handleEditorChange(event.target.value)}
                              onKeyDown={handleEditorKeyDown}
                              onScroll={handleEditorScroll}
                              spellCheck={false}
                              wrap="off"
                              disabled={interviewIsExpired}
                            />
                          </div>
                        </article>

                        <article className="panel workspace-panel">
                          <div className="workspace-tabs" role="tablist" aria-label="Query output">
                            {workspaceTabs.map((tab) => (
                              <button
                                key={tab.id}
                                type="button"
                                role="tab"
                                aria-selected={workspaceTab === tab.id}
                                className={`tab-button ${workspaceTab === tab.id ? 'active' : ''}`}
                                onClick={() => setWorkspaceTab(tab.id)}
                              >
                                {tab.label}
                              </button>
                            ))}
                          </div>

                          {workspaceTab === 'results' ? <div className="workspace-panel-body">{renderResultTable(queryResult)}</div> : null}

                          {workspaceTab === 'coach' ? (
                            <div className="workspace-panel-body stack">
                              <div className={`feedback-box ${feedback.status}`}>
                                <strong>{feedback.title}</strong>
                                <p>{feedback.message}</p>
                                {feedback.detail ? <small>{feedback.detail}</small> : null}
                              </div>
                              {currentChallenge ? (
                                <div className="hint-card adaptive-hint">
                                  <Search size={14} />
                                  <span>{renderHintBody(getAdaptiveCoachHint(currentChallenge, currentAttemptCount) ?? 'Run the query once to unlock the first coach hint.')}</span>
                                </div>
                              ) : null}
                              <div className="hint-stack">
                                {currentChallenge.hints.slice(0, hintStep).map((hint, index) => (
                                  <div key={`${currentChallenge.id}-hint-${index}`} className="hint-card">
                                    <Search size={14} />
                                    {renderHintBody(hint)}
                                  </div>
                                ))}
                                {hintStep < currentChallenge.hints.length ? (
                                  <button
                                    type="button"
                                    className="secondary-button"
                                    onClick={() => {
                                      const nextHintStep = hintStep + 1
                                      setHintStep(nextHintStep)

                                      if (currentChallenge && progressReady) {
                                        setProgress((current) => ({
                                          ...current,
                                          hintSteps: {
                                            ...(current.hintSteps ?? {}),
                                            [currentChallenge.id]: nextHintStep,
                                          },
                                        }))
                                      }
                                    }}
                                  >
                                    Reveal hint {hintStep + 1}
                                  </button>
                                ) : null}
                              </div>
                              {interviewAttemptSummary ? (
                                <div className="interview-summary-card">
                                  <div className="section-heading">
                                    <h4>Attempt summary</h4>
                                    <span>Rubric-based interview scoring</span>
                                  </div>
                                  <div className="interview-score">
                                    <strong>{interviewAttemptSummary.score}</strong>
                                    <span>/ 100</span>
                                  </div>
                                  <div className="interview-rubric">
                                    <div>
                                      <span>Accuracy</span>
                                      <strong>{interviewAttemptSummary.accuracyScore}</strong>
                                    </div>
                                    <div>
                                      <span>Speed</span>
                                      <strong>{interviewAttemptSummary.speedScore}</strong>
                                    </div>
                                    <div>
                                      <span>Discipline</span>
                                      <strong>{interviewAttemptSummary.disciplineScore}</strong>
                                    </div>
                                    <div>
                                      <span>Attempts</span>
                                      <strong>{interviewAttemptSummary.attempts}</strong>
                                    </div>
                                  </div>
                                  <small>
                                    {interviewAttemptSummary.status === 'expired'
                                      ? 'The timer expired before submission.'
                                      : interviewAttemptSummary.status === 'success'
                                        ? 'The query was correct within the time limit.'
                                        : 'The query ran but did not match the expected answer.'}
                                  </small>
                                </div>
                              ) : null}
                            </div>
                          ) : null}

                          {workspaceTab === 'explanation' ? (
                            <div className="workspace-panel-body stack">
                              {queryExplanationLines.length > 0 ? (
                                <div className="query-explanation-card">
                                  <div className="section-heading">
                                    <h4>How this query runs</h4>
                                    <span>Execution order and business meaning</span>
                                  </div>
                                  <ol>
                                    {queryExplanationLines.map((line, index) => (
                                      <li key={`${index}-${line}`}>{line}</li>
                                    ))}
                                  </ol>
                                </div>
                              ) : null}
                              {followUpPrompt ? (
                                <div className="explanation-stack">
                                  <div>
                                    <strong>Try this next</strong>
                                    <p>{followUpPrompt}</p>
                                  </div>
                                </div>
                              ) : null}
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
                              </div>
                              {view === 'learn' && feedback.status === 'success' ? (
                                <button type="button" className="primary-button lesson-progress-button" onClick={handleAdvanceLearnLesson}>
                                  <span>{nextLearnChallenge ? 'Next Lesson' : 'Finish Lessons'}</span>
                                </button>
                              ) : null}
                            </div>
                          ) : null}
                        </article>
                      </div>
                    </section>
                  ) : (
                    <>
                      <div className="panel detail-panel">
                        <div className="detail-header">
                          <div>
                            <span className="eyebrow">{currentChallenge.roleFocus}</span>
                            <h3>{currentChallenge.title}</h3>
                          </div>
                          {view === 'interview' && interviewSecondsLeft !== null ? (
                            <div className={`countdown ${interviewIsExpired ? 'expired' : ''}`}>
                              {interviewIsExpired ? 'Expired' : `${interviewSecondsLeft}s`}
                            </div>
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
                      </div>

                      <div className="panel editor-panel">
                        <div className="editor-toolbar">
                          <div className="toolbar-title">
                            <Database size={16} />
                            <span>SQLite Editor</span>
                          </div>
                          <div className="toolbar-actions">
                            <button type="button" className="secondary-button" onClick={handleExplainQuery}>
                              <Search size={16} />
                              <span>Explain</span>
                            </button>
                            {view === 'learn' ? (
                              <button
                                type="button"
                                className="secondary-button"
                                onClick={() => handleEditorChange(getLearnModePracticeSql(currentChallenge))}
                              >
                                <BookOpen size={16} />
                                <span>Scaffold</span>
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={() => handleEditorChange(getEditorSeedSql(currentChallenge, view))}
                            >
                              <RefreshCw size={16} />
                              <span>Reset</span>
                            </button>
                            <button type="button" className="secondary-button" onClick={handleFormatSql}>
                              <Sparkles size={16} />
                              <span>Format</span>
                            </button>
                            <button type="button" className="primary-button" onClick={handleRun} disabled={isRunning || interviewIsExpired}>
                              <Play size={16} />
                              <span>{isRunning ? 'Running…' : interviewIsExpired ? 'Time Expired' : 'Run Query'}</span>
                            </button>
                          </div>
                        </div>
                        {view === 'interview' ? (
                          <p className="editor-intro">
                            Work from memory first. The timer is enforced, and the score reflects correctness, speed, and how many hints you needed.
                          </p>
                        ) : (
                          <p className="editor-intro">Run the query to validate the result, then use the coach and explanation tabs for feedback.</p>
                        )}
                        <div className="code-editor-shell">
                          <div className="code-editor-gutter" aria-hidden="true">
                            <div className="code-editor-gutter-scroll" style={{ transform: `translateY(-${editorScrollTop}px)` }}>
                              {Array.from({ length: editorLineCount }, (_, index) => (
                                <span key={index}>{index + 1}</span>
                              ))}
                            </div>
                          </div>
                          <textarea
                            aria-label="SQL query editor"
                            value={editorSql}
                            onChange={(event) => handleEditorChange(event.target.value)}
                            onKeyDown={handleEditorKeyDown}
                            onScroll={handleEditorScroll}
                            spellCheck={false}
                            wrap="off"
                            disabled={interviewIsExpired}
                          />
                        </div>
                      </div>

                      <div className="panel workspace-panel">
                        <div className="workspace-tabs" role="tablist" aria-label="Query output">
                          {workspaceTabs.map((tab) => (
                            <button
                              key={tab.id}
                              type="button"
                              role="tab"
                              aria-selected={workspaceTab === tab.id}
                              className={`tab-button ${workspaceTab === tab.id ? 'active' : ''}`}
                              onClick={() => setWorkspaceTab(tab.id)}
                            >
                              {tab.label}
                            </button>
                          ))}
                        </div>

                        <div className="workspace-panel-body">
                          {workspaceTab === 'results' ? renderResultTable(queryResult) : null}
                          {workspaceTab === 'coach' ? (
                            <div className="stack">
                              <div className={`feedback-box ${feedback.status}`}>
                                <strong>{feedback.title}</strong>
                                <p>{feedback.message}</p>
                                {feedback.detail ? <small>{feedback.detail}</small> : null}
                              </div>
                              {currentChallenge ? (
                                <div className="hint-card adaptive-hint">
                                  <Search size={14} />
                                  <span>{renderHintBody(getAdaptiveCoachHint(currentChallenge, currentAttemptCount) ?? 'Run the query once to unlock the first coach hint.')}</span>
                                </div>
                              ) : null}
                              <div className="hint-stack">
                                {currentChallenge.hints.slice(0, hintStep).map((hint, index) => (
                                  <div key={`${currentChallenge.id}-hint-${index}`} className="hint-card">
                                    <Search size={14} />
                                    {renderHintBody(hint)}
                                  </div>
                                ))}
                                {hintStep < currentChallenge.hints.length ? (
                                  <button
                                    type="button"
                                    className="secondary-button"
                                    onClick={() => {
                                      const nextHintStep = hintStep + 1
                                      setHintStep(nextHintStep)

                                      if (currentChallenge && progressReady) {
                                        setProgress((current) => ({
                                          ...current,
                                          hintSteps: {
                                            ...(current.hintSteps ?? {}),
                                            [currentChallenge.id]: nextHintStep,
                                          },
                                        }))
                                      }
                                    }}
                                  >
                                    Reveal hint {hintStep + 1}
                                  </button>
                                ) : null}
                              </div>
                              {interviewAttemptSummary ? (
                                <div className="interview-summary-card">
                                  <div className="section-heading">
                                    <h4>Attempt summary</h4>
                                    <span>Rubric-based interview scoring</span>
                                  </div>
                                  <div className="interview-score">
                                    <strong>{interviewAttemptSummary.score}</strong>
                                    <span>/ 100</span>
                                  </div>
                                  <div className="interview-rubric">
                                    <div>
                                      <span>Accuracy</span>
                                      <strong>{interviewAttemptSummary.accuracyScore}</strong>
                                    </div>
                                    <div>
                                      <span>Speed</span>
                                      <strong>{interviewAttemptSummary.speedScore}</strong>
                                    </div>
                                    <div>
                                      <span>Discipline</span>
                                      <strong>{interviewAttemptSummary.disciplineScore}</strong>
                                    </div>
                                    <div>
                                      <span>Attempts</span>
                                      <strong>{interviewAttemptSummary.attempts}</strong>
                                    </div>
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                          {workspaceTab === 'explanation' ? (
                            <div className="stack">
                              {queryExplanationLines.length > 0 ? (
                                <div className="query-explanation-card">
                                  <div className="section-heading">
                                    <h4>How this query runs</h4>
                                    <span>Execution order and business meaning</span>
                                  </div>
                                  <ol>
                                    {queryExplanationLines.map((line, index) => (
                                      <li key={`${index}-${line}`}>{line}</li>
                                    ))}
                                  </ol>
                                </div>
                              ) : null}
                              {followUpPrompt ? (
                                <div className="explanation-stack">
                                  <div>
                                    <strong>Try this next</strong>
                                    <p>{followUpPrompt}</p>
                                  </div>
                                </div>
                              ) : null}
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
                              </div>
                              {view === 'learn' && feedback.status === 'success' ? (
                                <button type="button" className="primary-button lesson-progress-button" onClick={handleAdvanceLearnLesson}>
                                  <span>{nextLearnChallenge ? 'Next Lesson' : 'Finish Lessons'}</span>
                                </button>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </>
                  )}
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
